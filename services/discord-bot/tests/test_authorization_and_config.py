import json

import pytest

from baseballstattrack_discord.authorization import (
    BindingAuthorizer,
    InteractionContext,
    InteractionDenied,
)
from baseballstattrack_discord.config import ConfigurationError, Settings

ACCOUNT = "00000000-0000-4000-8000-000000000001"
TEAM = "00000000-0000-4000-8000-000000000002"
OTHER_TEAM = "00000000-0000-4000-8000-000000000004"
SEASON = "00000000-0000-4000-8000-000000000003"


def environment() -> dict[str, str]:
    return {
        "DISCORD_TOKEN": "discord-token-long-enough-for-validation",
        "BST_API_TOKEN": "api-token-long-enough-for-validation",
        "BST_API_BASE_URL": "https://stats.example.test",
        "BST_WEB_BASE_URL": "https://app.example.test",
        "DISCORD_TEAM_BINDINGS": json.dumps(
            [
                {
                    "guildId": "100",
                    "accountId": ACCOUNT,
                    "teamId": TEAM,
                    "defaultSeasonId": SEASON,
                    "channelIds": ["200"],
                    "roleIds": ["300"],
                }
            ]
        ),
    }


def test_settings_keep_secrets_out_of_repr_and_require_safe_urls() -> None:
    settings = Settings.from_environment(environment())
    assert "discord-token" not in repr(settings)
    assert "api-token" not in repr(settings)
    unsafe = {**environment(), "BST_API_BASE_URL": "http://stats.example.test"}
    with pytest.raises(ConfigurationError):
        Settings.from_environment(unsafe)


def test_binding_requires_exact_server_channel_role_and_team() -> None:
    binding = Settings.from_environment(environment()).bindings[0]
    authorizer = BindingAuthorizer((binding,))
    allowed = InteractionContext(100, 200, frozenset({300, 999}))
    assert authorizer.authorize(allowed, TEAM) == binding
    for denied in (
        InteractionContext(None, 200, frozenset({300})),
        InteractionContext(101, 200, frozenset({300})),
        InteractionContext(100, 201, frozenset({300})),
        InteractionContext(100, 200, frozenset({301})),
    ):
        with pytest.raises(InteractionDenied):
            authorizer.authorize(denied, TEAM)
    with pytest.raises(InteractionDenied):
        authorizer.authorize(allowed, OTHER_TEAM)
