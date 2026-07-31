from __future__ import annotations

from typing import Any, Mapping
from urllib.parse import quote

import httpx


class StatisticsApiFailure(RuntimeError):
    public_message = "Statistics are temporarily unavailable. Please try again later."


class StatisticsApiUnauthorized(StatisticsApiFailure):
    public_message = (
        "The statistics integration is not authorized. Contact an administrator."
    )


class StatisticsApiNotFound(StatisticsApiFailure):
    public_message = "No permitted statistics matched that request."


class StatisticsApiRateLimited(StatisticsApiFailure):
    def __init__(self, retry_after: str | None = None) -> None:
        self.retry_after = retry_after
        super().__init__(self.public_message)

    @property
    def public_message(self) -> str:  # type: ignore[override]
        suffix = (
            f" Try again in {self.retry_after} seconds." if self.retry_after else ""
        )
        return f"Statistics requests are temporarily limited.{suffix}"


class StatisticsApiContractError(StatisticsApiFailure):
    pass


class StatisticsApiClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.baseballstattrack.stats.v1+json",
                "User-Agent": "baseballstattrack-discord/0.1",
            },
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def season(
        self, account_id: str, season_id: str, team_id: str
    ) -> dict[str, Any]:
        data = await self._get(
            f"/api/v1/accounts/{quote(account_id)}/seasons/{quote(season_id)}/leaders",
            {"teamId": team_id},
        )
        if not isinstance(data, dict):
            raise StatisticsApiContractError("Season response must be an object")
        return data

    async def game(self, account_id: str, game_id: str) -> dict[str, Any]:
        data = await self._get(
            f"/api/v1/accounts/{quote(account_id)}/games/{quote(game_id)}/box-score"
        )
        if not isinstance(data, dict):
            raise StatisticsApiContractError("Game response must be an object")
        return data

    async def _get(self, path: str, parameters: Mapping[str, str] | None = None) -> Any:
        return (await self._request(path, parameters)).get("data")

    async def _request(
        self, path: str, parameters: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        try:
            response = await self._client.get(path, params=parameters)
        except httpx.HTTPError as error:
            raise StatisticsApiFailure() from error
        if response.status_code in {401, 403}:
            raise StatisticsApiUnauthorized()
        if response.status_code == 404:
            raise StatisticsApiNotFound()
        if response.status_code == 429:
            raise StatisticsApiRateLimited(response.headers.get("Retry-After"))
        if response.status_code >= 400:
            raise StatisticsApiFailure()
        try:
            payload = response.json()
        except ValueError as error:
            raise StatisticsApiContractError("API response was not JSON") from error
        if (
            not isinstance(payload, dict)
            or payload.get("apiVersion") != "v1"
            or "data" not in payload
        ):
            raise StatisticsApiContractError("API version envelope is malformed")
        return payload
