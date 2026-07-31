from __future__ import annotations

from typing import Any

DISCORD_MESSAGE_LIMIT = 2_000


def _safe(value: object, fallback: str = "—") -> str:
    text = str(value).strip() if value is not None else ""
    return text[:160] if text else fallback


def _record(record: object) -> str:
    if not isinstance(record, dict):
        return "Record unavailable"
    return (
        f"{record.get('wins', 0)}-{record.get('losses', 0)}"
        f"-{record.get('ties', 0)}"
        f" | incomplete {record.get('incomplete', 0)}"
        f" | awaiting reverification {record.get('correctedAwaitingReverification', 0)}"
    )


def team_stats(data: dict[str, Any]) -> str:
    selection = data.get("selection") if isinstance(data.get("selection"), dict) else {}
    title = _safe(selection.get("teamDisplayName"), "Team statistics")
    season = _safe(selection.get("seasonDisplayName"), "Season")
    return _bounded(
        f"**{title} — {season}**\n"
        f"{_record(data.get('record'))}\n"
        f"Freshness: `{_safe(data.get('freshness'), 'UNKNOWN')}` | "
        f"verified games only for official statistics"
    )


def player_stats(data: dict[str, Any], player_id: str, category: str) -> str:
    players = data.get("players")
    if not isinstance(players, list):
        return "Player statistics are not available from this API response."
    player = next(
        (
            item
            for item in players
            if isinstance(item, dict) and item.get("playerId") == player_id
        ),
        None,
    )
    if player is None:
        return "No verified statistics are available for that permitted player."
    line = player.get(category)
    if not isinstance(line, dict):
        name = _safe(player.get("displayName"), "Player")
        return f"**{name}** has no verified {category} line."
    counters = line.get("counters")
    rates = line.get("rates")
    pieces: list[str] = []
    if isinstance(counters, dict):
        pieces.extend(
            f"{_label(key)} {_safe(value)}"
            for key, value in list(counters.items())[:10]
        )
    if isinstance(rates, dict):
        pieces.extend(
            f"{_label(key)} {_rate(value)}" for key, value in list(rates.items())[:5]
        )
    body = " | ".join(pieces) or "No verified counting statistics."
    return _bounded(
        f"**{_safe(player.get('displayName'), 'Player')} — {category.title()}**\n{body}"
    )


def leaders(data: dict[str, Any], category: str, count: int = 10) -> str:
    leaderboards = data.get("leaders")
    rows = leaderboards.get(category) if isinstance(leaderboards, dict) else None
    if not isinstance(rows, list) or not rows:
        return f"No qualified {category} leaders are available yet."
    lines = [f"**{category.title()} leaders**"]
    for index, row in enumerate(rows[:count], start=1):
        if not isinstance(row, dict):
            continue
        lines.append(
            f"{index}. {_safe(row.get('displayName'), 'Player')} — "
            f"{_rate(row.get('rate'))} ({_safe(row.get('sampleSize'), '0')} sample)"
        )
    return _bounded("\n".join(lines))


def game(data: dict[str, Any], web_base_url: str) -> str:
    teams = data.get("teams") if isinstance(data.get("teams"), dict) else {}
    score = data.get("score") if isinstance(data.get("score"), dict) else {}
    away = teams.get("AWAY") if isinstance(teams.get("AWAY"), dict) else {}
    home = teams.get("HOME") if isinstance(teams.get("HOME"), dict) else {}
    game_id = _safe(data.get("id"), "")
    link = f"{web_base_url}/games/{game_id}/box-score" if game_id else web_base_url
    return _bounded(
        f"**{_safe(away.get('displayName'), 'Away')} {score.get('AWAY', 0)} — "
        f"{_safe(home.get('displayName'), 'Home')} {score.get('HOME', 0)}**\n"
        f"Status: `{_safe(data.get('reportState'), 'UNKNOWN')}` | "
        f"corrections: `{_safe(data.get('correctionStatus'), 'UNKNOWN')}`\n"
        f"<{link}>"
    )


def recent_games(data: dict[str, Any], count: int) -> str:
    rows = data.get("recentGames")
    if not isinstance(rows, list) or not rows:
        return "No recent games are available for this team and season."
    lines = ["**Recent games**"]
    for row in rows[:count]:
        if not isinstance(row, dict):
            continue
        score = f"{row.get('scoreFor', 0)}-{row.get('scoreAgainst', 0)}"
        lines.append(
            f"• {_safe(row.get('scheduledAt'), 'Unscheduled')} vs "
            f"{_safe(row.get('opponentDisplayName'), 'Opponent')}: {score} "
            f"`{_safe(row.get('status'), 'UNKNOWN')}`"
        )
    return _bounded("\n".join(lines))


def help_message() -> str:
    return (
        "**Baseball Stat Track commands**\n"
        "`/team-stats` team record and season status\n"
        "`/player-stats` verified batting, pitching, or fielding line\n"
        "`/leaders` qualified season leaders\n"
        "`/game` score, status, correction state, and box-score link\n"
        "`/recent-games` recent team results\n"
        "Commands are read-only and require an approved server, channel, role, "
        "and team binding."
    )


def _rate(value: object) -> str:
    if not isinstance(value, dict):
        return "—"
    formatted = value.get("formatted") or value.get("decimal")
    if formatted is not None:
        return _safe(formatted)
    numerator, denominator = value.get("numerator"), value.get("denominator")
    return f"{numerator}/{denominator}" if denominator else "—"


def _label(value: object) -> str:
    text = str(value)
    return "".join(
        f" {character}" if character.isupper() else character for character in text
    ).title()


def _bounded(message: str) -> str:
    if len(message) <= DISCORD_MESSAGE_LIMIT:
        return message
    return f"{message[: DISCORD_MESSAGE_LIMIT - 16]}\n…truncated"
