from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Literal

import discord
from discord import app_commands
from discord.ext import commands

from . import formatting
from .api import StatisticsApiFailure
from .authorization import InteractionContext, InteractionDenied
from .commands import CommandRequest, CommandService, InvalidCommandInput
from .config import Settings

logger = logging.getLogger(__name__)
Category = Literal["batting", "pitching", "fielding"]


class StatsBot(commands.Bot):
    def __init__(self, settings: Settings, service: CommandService) -> None:
        super().__init__(
            command_prefix=commands.when_mentioned, intents=discord.Intents.none()
        )
        self._settings = settings
        self._service = service
        self._register_commands()

    async def setup_hook(self) -> None:
        for guild_id in sorted(
            {binding.guild_id for binding in self._settings.bindings}
        ):
            guild = discord.Object(id=guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)

    def _context(self, interaction: discord.Interaction) -> InteractionContext:
        roles = getattr(interaction.user, "roles", ())
        return InteractionContext(
            guild_id=interaction.guild_id,
            channel_id=interaction.channel_id,
            role_ids=frozenset(role.id for role in roles),
        )

    def _request(
        self,
        interaction: discord.Interaction,
        team_id: str | None,
        season_id: str | None,
    ) -> CommandRequest:
        return CommandRequest(self._context(interaction), team_id, season_id)

    async def _run(
        self,
        interaction: discord.Interaction,
        operation: Callable[[], Awaitable[str]],
    ) -> None:
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            message = await operation()
        except (InvalidCommandInput, InteractionDenied) as error:
            message = str(error)
        except StatisticsApiFailure as error:
            message = error.public_message
        except Exception:
            logger.exception(
                "discord_command_failed",
                extra={"interaction_id": str(interaction.id)},
            )
            message = "The command could not be completed. Please try again later."
        await interaction.followup.send(
            message[: formatting.DISCORD_MESSAGE_LIMIT],
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )

    def _register_commands(self) -> None:
        @self.tree.command(name="team-stats", description="Show a team's season record")
        async def team_stats(
            interaction: discord.Interaction,
            season_id: str | None = None,
            team_id: str | None = None,
        ) -> None:
            await self._run(
                interaction,
                lambda: self._service.team_stats(
                    self._request(interaction, team_id, season_id)
                ),
            )

        @self.tree.command(
            name="player-stats", description="Show a player's verified season line"
        )
        async def player_stats(
            interaction: discord.Interaction,
            player_id: str,
            category: Category,
            season_id: str | None = None,
            team_id: str | None = None,
        ) -> None:
            await self._run(
                interaction,
                lambda: self._service.player_stats(
                    self._request(interaction, team_id, season_id), player_id, category
                ),
            )

        @self.tree.command(name="leaders", description="Show qualified season leaders")
        async def leaders(
            interaction: discord.Interaction,
            category: Category,
            season_id: str | None = None,
            team_id: str | None = None,
        ) -> None:
            await self._run(
                interaction,
                lambda: self._service.leaders(
                    self._request(interaction, team_id, season_id), category
                ),
            )

        @self.tree.command(name="game", description="Show a score and box-score link")
        async def game(
            interaction: discord.Interaction,
            game_id: str,
            season_id: str | None = None,
            team_id: str | None = None,
        ) -> None:
            await self._run(
                interaction,
                lambda: self._service.game(
                    self._request(interaction, team_id, season_id), game_id
                ),
            )

        @self.tree.command(name="recent-games", description="Show recent team games")
        async def recent_games(
            interaction: discord.Interaction,
            count: app_commands.Range[int, 1, 10] = 5,
            season_id: str | None = None,
            team_id: str | None = None,
        ) -> None:
            await self._run(
                interaction,
                lambda: self._service.recent_games(
                    self._request(interaction, team_id, season_id), count
                ),
            )

        @self.tree.command(
            name="help", description="Show command and permission guidance"
        )
        async def help_command(interaction: discord.Interaction) -> None:
            await self._run(interaction, _help)


async def _help() -> str:
    return formatting.help_message()
