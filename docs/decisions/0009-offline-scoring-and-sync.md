# ADR 0009: Bounded single-writer offline scoring

- Status: Accepted for M7 discovery and implementation gating
- Date: 2026-07-31
- Issue: #34

## Context

Fields have unreliable connectivity, while the application treats accepted
ordered events and deterministic replay as baseball authority. General
multi-master offline editing would make order, authorization, corrections,
audit, and player-data protection ambiguous. M2 already supports one recoverable
unaccepted draft and exact idempotent retry, but intentionally has no offline
queue.

## Decision

Commit to a bounded M7 offline scoring mode for one designated writer, game,
setup, Account, and short-lived server-issued device session. Local items are
proposals until the server reauthenticates, reauthorizes, validates the session,
and atomically replays the unchanged ordered batch against its exact base
revision/hash.

Never automatically merge a diverged server and device branch. Surface the
conflict to an authorized human and recover through ordinary re-entry or
correction events. Store the minimum queue in a versioned encrypted IndexedDB
boundary; do not cache authenticated API responses or treat browser encryption
as protection from same-origin compromise.

The complete constraints, M2 reuse map, support cost, and go/no-go evidence are
defined in
[Offline scoring and conflict-safe sync decision](../OFFLINE_SCORING_AND_SYNC_DECISION.md).

## Consequences

The product can address brief and extended field outages without weakening the
event model, but unsynced device loss may lose work and revoked offline clients
may keep local proposals until reconnect. M7 requires device grants, queue
migrations, batch replay, conflict/recovery UI, security/privacy controls,
cross-browser testing, and material support ownership.

General offline administration, multi-writer merging, server overwrite by a
device branch, and silent conflict resolution remain rejected.
