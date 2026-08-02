from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
from datetime import UTC, datetime

from .api import StatisticsApiClient
from .authorization import BindingAuthorizer
from .bot import StatsBot
from .commands import CommandService
from .config import ConfigurationError, Settings
from .health import start_health_server


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "severity": record.levelname.lower(),
                "service": "baseballstattrack-discord",
                "event": record.getMessage(),
                **(
                    {"interactionId": record.interaction_id}
                    if hasattr(record, "interaction_id")
                    else {}
                ),
            },
            separators=(",", ":"),
        )


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    logging.getLogger("discord").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def run_stub(settings: Settings, stop: asyncio.Event | None = None) -> None:
    stop_event = stop or asyncio.Event()
    loop = asyncio.get_running_loop()
    installed_signals: list[signal.Signals] = []
    if stop is None:
        for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(shutdown_signal, stop_event.set)
                installed_signals.append(shutdown_signal)
            except NotImplementedError:  # pragma: no cover - Windows fallback
                pass

    server = await start_health_server(
        settings.health_host, settings.health_port, lambda: True
    )
    logging.getLogger(__name__).info("discord_provider_stub_ready")
    try:
        await stop_event.wait()
    finally:
        server.close()
        await server.wait_closed()
        for shutdown_signal in installed_signals:
            loop.remove_signal_handler(shutdown_signal)


async def run(settings: Settings) -> None:
    if settings.provider_mode == "stub":
        await run_stub(settings)
        return

    api = StatisticsApiClient(
        settings.api_base_url,
        settings.api_token,
        settings.request_timeout_seconds,
    )
    service = CommandService(
        api,
        BindingAuthorizer(settings.bindings),
        settings.web_base_url,
    )
    bot = StatsBot(settings, service)
    server = await start_health_server(
        settings.health_host, settings.health_port, bot.is_ready
    )
    loop = asyncio.get_running_loop()
    installed_signals: list[signal.Signals] = []
    shutdown_task: asyncio.Task[None] | None = None

    def request_shutdown() -> None:
        nonlocal shutdown_task
        if shutdown_task is None:
            logging.getLogger(__name__).info("discord_gateway_shutdown_requested")
            shutdown_task = loop.create_task(bot.close())

    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(shutdown_signal, request_shutdown)
            installed_signals.append(shutdown_signal)
        except NotImplementedError:  # pragma: no cover - Windows fallback
            pass
    try:
        await bot.start(settings.discord_token, reconnect=True)
    finally:
        for shutdown_signal in installed_signals:
            loop.remove_signal_handler(shutdown_signal)
        server.close()
        await server.wait_closed()
        await api.close()
        if not bot.is_closed():
            await bot.close()
        if shutdown_task is not None:
            await shutdown_task


def main() -> None:
    configure_logging()
    try:
        settings = Settings.from_environment()
    except ConfigurationError as error:
        logging.getLogger(__name__).critical("configuration_invalid: %s", error)
        raise SystemExit(2) from error
    asyncio.run(run(settings))


if __name__ == "__main__":
    main()
