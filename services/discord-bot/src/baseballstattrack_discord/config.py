from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Literal, Mapping
from urllib.parse import urlparse
from uuid import UUID


class ConfigurationError(ValueError):
    """Raised when production configuration is absent or unsafe."""


def canonical_uuid(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise ConfigurationError(f"{field_name} must be a UUID string")
    try:
        parsed = UUID(value)
    except ValueError as error:
        raise ConfigurationError(f"{field_name} must be a UUID string") from error
    if str(parsed) != value.lower():
        raise ConfigurationError(f"{field_name} must use canonical UUID syntax")
    return str(parsed)


def snowflakes(value: object, field_name: str) -> frozenset[int]:
    if not isinstance(value, list) or not value:
        raise ConfigurationError(f"{field_name} must be a non-empty list")
    parsed: set[int] = set()
    for item in value:
        try:
            snowflake = int(item)
        except (TypeError, ValueError) as error:
            raise ConfigurationError(f"{field_name} contains an invalid ID") from error
        if snowflake <= 0:
            raise ConfigurationError(f"{field_name} contains an invalid ID")
        parsed.add(snowflake)
    return frozenset(parsed)


@dataclass(frozen=True)
class TeamBinding:
    guild_id: int
    account_id: str
    team_id: str
    channel_ids: frozenset[int]
    role_ids: frozenset[int]
    default_season_id: str | None = None

    @classmethod
    def from_mapping(cls, value: object) -> TeamBinding:
        if not isinstance(value, dict):
            raise ConfigurationError("each Discord binding must be an object")
        try:
            guild_id = int(value["guildId"])
        except (KeyError, TypeError, ValueError) as error:
            raise ConfigurationError("guildId must be a Discord ID") from error
        if guild_id <= 0:
            raise ConfigurationError("guildId must be a Discord ID")
        default_season = value.get("defaultSeasonId")
        return cls(
            guild_id=guild_id,
            account_id=canonical_uuid(value.get("accountId"), "accountId"),
            team_id=canonical_uuid(value.get("teamId"), "teamId"),
            channel_ids=snowflakes(value.get("channelIds"), "channelIds"),
            role_ids=snowflakes(value.get("roleIds"), "roleIds"),
            default_season_id=(
                canonical_uuid(default_season, "defaultSeasonId")
                if default_season is not None
                else None
            ),
        )


@dataclass(frozen=True)
class Settings:
    discord_token: str = field(repr=False)
    api_token: str = field(repr=False)
    api_base_url: str
    web_base_url: str
    bindings: tuple[TeamBinding, ...]
    provider_mode: Literal["gateway", "stub"] = "gateway"
    health_host: str = "0.0.0.0"  # noqa: S104 - container health listener
    health_port: int = 8080
    request_timeout_seconds: float = 8.0

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if environment is None else environment
        provider_mode = env.get("DISCORD_PROVIDER_MODE", "gateway").strip().lower()
        if provider_mode not in {"gateway", "stub"}:
            raise ConfigurationError(
                "DISCORD_PROVIDER_MODE must be either gateway or stub"
            )
        discord_token = env.get("DISCORD_TOKEN", "").strip()
        api_token = env.get("BST_API_TOKEN", "").strip()
        if provider_mode == "gateway" and len(discord_token) < 20:
            raise ConfigurationError("DISCORD_TOKEN is required")
        if provider_mode == "gateway" and len(api_token) < 20:
            raise ConfigurationError("BST_API_TOKEN is required")

        api_base_url = _url(env.get("BST_API_BASE_URL"), "BST_API_BASE_URL")
        web_base_url = _url(env.get("BST_WEB_BASE_URL"), "BST_WEB_BASE_URL")
        raw_bindings = env.get("DISCORD_TEAM_BINDINGS", "")
        try:
            decoded = json.loads(raw_bindings)
        except json.JSONDecodeError as error:
            raise ConfigurationError(
                "DISCORD_TEAM_BINDINGS must be valid JSON"
            ) from error
        if not isinstance(decoded, list) or (
            provider_mode == "gateway" and not decoded
        ):
            raise ConfigurationError(
                "DISCORD_TEAM_BINDINGS must be a non-empty array"
                if provider_mode == "gateway"
                else "DISCORD_TEAM_BINDINGS must be an array"
            )
        bindings = tuple(TeamBinding.from_mapping(item) for item in decoded)
        if len({(item.guild_id, item.team_id) for item in bindings}) != len(bindings):
            raise ConfigurationError("Discord guild/team bindings must be unique")
        try:
            health_port = int(env.get("HEALTH_PORT", "8080"))
            timeout = float(env.get("BST_API_TIMEOUT_SECONDS", "8"))
        except ValueError as error:
            raise ConfigurationError(
                "health port and API timeout must be numeric"
            ) from error
        if not 1 <= health_port <= 65535 or not 0.5 <= timeout <= 30:
            raise ConfigurationError(
                "health port or API timeout is outside its safe range"
            )
        return cls(
            discord_token=discord_token,
            api_token=api_token,
            api_base_url=api_base_url,
            web_base_url=web_base_url,
            bindings=bindings,
            provider_mode=provider_mode,
            health_host=env.get(
                "HEALTH_HOST",
                "0.0.0.0",  # noqa: S104 - container health listener
            ),
            health_port=health_port,
            request_timeout_seconds=timeout,
        )


def _url(value: str | None, field_name: str) -> str:
    candidate = (value or "").strip().rstrip("/")
    parsed = urlparse(candidate)
    local = parsed.hostname in {"127.0.0.1", "localhost", "host.docker.internal"}
    if (
        parsed.scheme not in ({"http", "https"} if local else {"https"})
        or not parsed.netloc
    ):
        raise ConfigurationError(f"{field_name} must be an HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConfigurationError(
            f"{field_name} must not contain credentials or parameters"
        )
    return candidate
