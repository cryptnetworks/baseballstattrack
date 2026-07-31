from __future__ import annotations

from dataclasses import dataclass

from .config import TeamBinding, canonical_uuid


class InteractionDenied(PermissionError):
    """A deliberately non-enumerating Discord authorization failure."""


@dataclass(frozen=True)
class InteractionContext:
    guild_id: int | None
    channel_id: int | None
    role_ids: frozenset[int]


class BindingAuthorizer:
    def __init__(self, bindings: tuple[TeamBinding, ...]) -> None:
        self._bindings = bindings

    def authorize(
        self, context: InteractionContext, requested_team_id: str | None = None
    ) -> TeamBinding:
        if context.guild_id is None or context.channel_id is None:
            raise InteractionDenied("This command is unavailable in this context.")
        team_id = (
            canonical_uuid(requested_team_id, "team_id")
            if requested_team_id is not None
            else None
        )
        candidates = [
            binding
            for binding in self._bindings
            if binding.guild_id == context.guild_id
            and context.channel_id in binding.channel_ids
            and bool(context.role_ids.intersection(binding.role_ids))
            and (team_id is None or binding.team_id == team_id)
        ]
        if len(candidates) != 1:
            raise InteractionDenied("This command is unavailable in this context.")
        return candidates[0]
