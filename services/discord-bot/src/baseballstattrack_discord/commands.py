from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from . import formatting
from .api import StatisticsApiClient
from .authorization import BindingAuthorizer, InteractionContext
from .config import TeamBinding


class InvalidCommandInput(ValueError):
    pass


def external_id(value: str, name: str) -> str:
    try:
        parsed = UUID(value)
    except (AttributeError, ValueError) as error:
        raise InvalidCommandInput(f"{name} must be a valid ID.") from error
    if str(parsed) != value.lower():
        raise InvalidCommandInput(f"{name} must be a valid ID.")
    return str(parsed)


@dataclass(frozen=True)
class CommandRequest:
    context: InteractionContext
    team_id: str | None = None
    season_id: str | None = None


class CommandService:
    def __init__(
        self,
        api: StatisticsApiClient,
        authorizer: BindingAuthorizer,
        web_base_url: str,
    ) -> None:
        self._api = api
        self._authorizer = authorizer
        self._web_base_url = web_base_url

    def _scope(self, request: CommandRequest) -> tuple[TeamBinding, str]:
        requested_team = (
            external_id(request.team_id, "team_id") if request.team_id else None
        )
        binding = self._authorizer.authorize(request.context, requested_team)
        season = request.season_id or binding.default_season_id
        if season is None:
            raise InvalidCommandInput("season_id is required for this team.")
        return binding, external_id(season, "season_id")

    async def team_stats(self, request: CommandRequest) -> str:
        binding, season = self._scope(request)
        data = await self._api.season(binding.account_id, season, binding.team_id)
        return formatting.team_stats(data)

    async def player_stats(
        self, request: CommandRequest, player_id: str, category: str
    ) -> str:
        if category not in {"batting", "pitching", "fielding"}:
            raise InvalidCommandInput(
                "category must be batting, pitching, or fielding."
            )
        binding, season = self._scope(request)
        player = external_id(player_id, "player_id")
        data = await self._api.season(binding.account_id, season, binding.team_id)
        return formatting.player_stats(data, player, category)

    async def leaders(self, request: CommandRequest, category: str) -> str:
        if category not in {"batting", "pitching", "fielding"}:
            raise InvalidCommandInput(
                "category must be batting, pitching, or fielding."
            )
        binding, season = self._scope(request)
        data = await self._api.season(binding.account_id, season, binding.team_id)
        return formatting.leaders(data, category)

    async def game(self, request: CommandRequest, game_id: str) -> str:
        binding = self._authorizer.authorize(
            request.context,
            external_id(request.team_id, "team_id") if request.team_id else None,
        )
        data = await self._api.game(binding.account_id, external_id(game_id, "game_id"))
        if data.get("accountTeamId") != binding.team_id:
            return "No permitted game matched that team and season."
        if data.get("seasonId") and request.season_id:
            expected = external_id(request.season_id, "season_id")
            if data.get("seasonId") != expected:
                return "No permitted game matched that team and season."
        return formatting.game(data, self._web_base_url)

    async def recent_games(self, request: CommandRequest, count: int = 5) -> str:
        if count < 1 or count > 10:
            raise InvalidCommandInput("count must be between 1 and 10.")
        binding, season = self._scope(request)
        data = await self._api.season(binding.account_id, season, binding.team_id)
        return formatting.recent_games(data, count)
