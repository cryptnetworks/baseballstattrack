import asyncio

import pytest

from baseballstattrack_discord.config import Settings
from baseballstattrack_discord.main import run_stub


@pytest.mark.asyncio
async def test_stub_becomes_ready_and_stops_without_provider_credentials() -> None:
    stop = asyncio.Event()
    stop.set()
    settings = Settings(
        discord_token="",
        api_token="",
        api_base_url="https://app.example.test",
        web_base_url="https://app.example.test",
        bindings=(),
        provider_mode="stub",
        health_host="127.0.0.1",
        health_port=0,
    )

    await run_stub(settings, stop)
