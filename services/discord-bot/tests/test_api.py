import httpx
import pytest

from baseballstattrack_discord.api import (
    StatisticsApiClient,
    StatisticsApiContractError,
    StatisticsApiRateLimited,
    StatisticsApiUnauthorized,
)


@pytest.mark.asyncio
async def test_client_requires_v1_contract_and_sends_bearer_secret() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer secret-token"
        assert request.headers["accept"].endswith("stats.v1+json")
        return httpx.Response(200, json={"apiVersion": "v1", "data": {"record": {}}})

    client = StatisticsApiClient(
        "https://stats.example.test",
        "secret-token",
        1,
        httpx.MockTransport(handler),
    )
    try:
        result = await client.season("account", "season", "team")
        assert result == {"record": {}}
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "exception"),
    [
        (401, StatisticsApiUnauthorized),
        (403, StatisticsApiUnauthorized),
        (429, StatisticsApiRateLimited),
    ],
)
async def test_client_maps_safe_failures(
    status: int, exception: type[Exception]
) -> None:
    client = StatisticsApiClient(
        "https://stats.example.test",
        "secret-token",
        1,
        httpx.MockTransport(lambda _request: httpx.Response(status)),
    )
    try:
        with pytest.raises(exception):
            await client.game("account", "game")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_client_rejects_unversioned_success() -> None:
    client = StatisticsApiClient(
        "https://stats.example.test",
        "secret-token",
        1,
        httpx.MockTransport(lambda _request: httpx.Response(200, json={"data": {}})),
    )
    try:
        with pytest.raises(StatisticsApiContractError):
            await client.game("account", "game")
    finally:
        await client.close()
