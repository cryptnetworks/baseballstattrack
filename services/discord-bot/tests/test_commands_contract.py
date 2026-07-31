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


class RepresentativeApi:
    async def season(
        self, account_id: str, season_id: str, team_id: str
    ) -> dict[str, Any]:
        assert (account_id, season_id, team_id) == (ACCOUNT, SEASON, TEAM)
        return {
            "seasonId": SEASON,
            "teamId": TEAM,
            "freshness": "CURRENT_SOURCE_DERIVED",
            "selection": {"teamDisplayName": "Stars", "seasonDisplayName": "2026"},
            "record": {
                "wins": 8,
                "losses": 2,
                "ties": 1,
                "incomplete": 1,
                "correctedAwaitingReverification": 1,
            },
            "leaders": {
                "batting": [
                    {
                        "playerId": PLAYER,
                        "displayName": "Jordan",
                        "sampleSize": 22,
                        "rate": {"formatted": ".412"},
                    }
                ]
            },
            "players": [
                {
                    "playerId": PLAYER,
                    "displayName": "Jordan",
                    "batting": {
                        "playerId": PLAYER,
                        "counters": {"hits": 9, "plateAppearances": 22},
                        "rates": {"battingAverage": {"formatted": ".412"}},
                    },
                    "pitching": None,
                    "fielding": None,
                    "sourceGames": [{"gameId": GAME, "verificationState": "VERIFIED"}],
                }
            ],
            "recentGames": [
                {
                    "gameId": GAME,
                    "scheduledAt": "2026-07-30T19:00:00.000Z",
                    "opponentDisplayName": "Comets",
                    "status": "CORRECTED",
                    "verificationState": "UNVERIFIED",
                    "confidence": "CORRECTED",
                    "scoreFor": 6,
                    "scoreAgainst": 4,
                }
            ],
        }

    async def game(self, account_id: str, game_id: str) -> dict[str, Any]:
        assert (account_id, game_id) == (ACCOUNT, GAME)
        return {
            "id": GAME,
            "accountTeamId": TEAM,
            "seasonId": SEASON,
            "reportState": "CORRECTED",
            "correctionStatus": "CORRECTED_HISTORY",
            "score": {"AWAY": 4, "HOME": 6},
            "teams": {
                "AWAY": {"displayName": "Comets"},
                "HOME": {"displayName": "Stars"},
            },
        }


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
