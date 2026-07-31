from __future__ import annotations

import asyncio
import json
import logging
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


async def run(settings: Settings) -> None:
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
    try:
        await bot.start(settings.discord_token, reconnect=True)
    finally:
        server.close()
        await server.wait_closed()
        await api.close()
        if not bot.is_closed():
            await bot.close()


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
