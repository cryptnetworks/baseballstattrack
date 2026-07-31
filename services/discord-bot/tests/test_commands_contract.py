import json
from pathlib import Path
from typing import Any

import pytest

from baseballstattrack_discord.authorization import (
    BindingAuthorizer,
    InteractionContext,
)
from baseballstattrack_discord.commands import (
    CommandRequest,
    CommandService,
    InvalidCommandInput,
)
from baseballstattrack_discord.config import TeamBinding

ACCOUNT = "00000000-0000-4000-8000-000000000001"
TEAM = "00000000-0000-4000-8000-000000000002"
SEASON = "00000000-0000-4000-8000-000000000003"
PLAYER = "00000000-0000-4000-8000-000000000004"
GAME = "00000000-0000-4000-8000-000000000005"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def contract_example(name: str) -> dict[str, Any]:
    payload = json.loads(
        (REPOSITORY_ROOT / "docs" / "api" / "examples" / name).read_text()
    )
    assert payload["apiVersion"] == "v1"
    return payload["data"]


class RepresentativeApi:
    async def season(
        self, account_id: str, season_id: str, team_id: str
    ) -> dict[str, Any]:
        assert (account_id, season_id, team_id) == (ACCOUNT, SEASON, TEAM)
        return contract_example("season-leaders-corrected.json")

    async def game(self, account_id: str, game_id: str) -> dict[str, Any]:
        assert (account_id, game_id) == (ACCOUNT, GAME)
        return contract_example("game-box-score-corrected.json")


def service() -> CommandService:
    binding = TeamBinding(
        100, ACCOUNT, TEAM, frozenset({200}), frozenset({300}), SEASON
    )
    return CommandService(
        RepresentativeApi(),  # type: ignore[arg-type]
        BindingAuthorizer((binding,)),
        "https://app.example.test",
    )


def request() -> CommandRequest:
    return CommandRequest(InteractionContext(100, 200, frozenset({300})))


@pytest.mark.asyncio
async def test_representative_api_contract_drives_all_stats_views() -> None:
    commands = service()
    assert "8-2-1" in await commands.team_stats(request())
    assert "Jordan" in await commands.player_stats(request(), PLAYER, "batting")
    assert "Jordan" in await commands.leaders(request(), "batting")
    assert "CORRECTED_HISTORY" in await commands.game(request(), GAME)
    assert "Comets" in await commands.recent_games(request())


@pytest.mark.asyncio
async def test_commands_validate_external_ids_and_ranges() -> None:
    commands = service()
    with pytest.raises(InvalidCommandInput):
        await commands.player_stats(request(), "private-database-key", "batting")
    with pytest.raises(InvalidCommandInput):
        await commands.leaders(request(), "unknown")
    with pytest.raises(InvalidCommandInput):
        await commands.recent_games(request(), 11)
