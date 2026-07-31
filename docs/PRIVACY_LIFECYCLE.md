# Privacy lifecycle, export, and deletion

This is the production product baseline for Account, user, and player privacy
workflows. It implements the decisions in `PRIVACY_AND_THREAT_MODEL.md`; it is
not legal advice or a claim that a hosting/provider configuration has been
verified. Requests that cannot achieve their purpose through the baseline must
stop for accountable privacy/legal review.

## Authorization and lifecycle states

Every operation uses a freshly resolved trusted actor at the server boundary,
an exact Account target, and a dedicated capability:

| Operation                              | Capability and additional rule                                      |
| -------------------------------------- | ------------------------------------------------------------------- |
| Prepare/download/cancel Account export | `report.export`; same actor plus one-time artifact token            |
| Request/cancel Account deletion        | `account.delete_request`; exact Account and exact confirmation      |
| Request/cancel user detachment         | `privacy.request`; a user may request only its own application user |
| Request player pseudonymization        | `privacy.manage`; exact Account-scoped player                       |
| Place/release a hold                   | `privacy.manage`; exact Account, optionally one request             |
| Execute deletion/pseudonymization      | `privacy.manage`; service actor only                                |

Cross-Account identifiers, missing targets, invalid/expired tokens, completed or
cancelled requests, and wrong actors fail without revealing which check failed.
Browser mutation routes require same-origin requests. A client idempotency key
is unique per Account and actor; an exact request returns the existing request,
while reuse for different input is a conflict.

Lifecycle requests are append-preserving records with `REQUESTED`, `BLOCKED`,
`CANCELLED`, or `COMPLETED` state. Account and user requests have a seven-day
cancellation window. Player pseudonymization may be executed immediately.
Execution is a single serializable transaction, and the required security audit
is in that transaction: a partial database mutation or missing audit rolls back.

## Export preparation and secure download

The JSON data format and field allowlists remain in
`DATA_EXPORT_AND_IMPORT.md`. Export is now a two-step flow:

1. an authorized same-origin `POST /api/data/export` registers a short-lived,
   one-time grant; no export body is generated or stored;
2. the response returns an opaque artifact id, a 256-bit token, and an expiry;
3. an authorized `GET /api/data/export` supplies the token in
   `X-Export-Token`, never a URL; and
4. the server reauthorizes the current membership/capability, atomically
   consumes the grant, then generates and returns current no-store JSON.

Grants expire after five minutes and are one-time. Only a SHA-256 verifier is
stored; no private export body waits in the database. Download, observed expiry,
cancellation, Account deletion, or revocation clears the verifier. Repeating the
preparation idempotency key safely rotates it, so an earlier token stops working.
`DELETE /api/data/export` cancels prepared work. Browser cancellation attempts
this cleanup, while server-enforced expiry remains authoritative if the client
disconnects.

Audit records contain only artifact id, checksum, byte count, expiry, outcome,
and safe reason—not the token, export body, player names, event payloads, or
request body. TLS and database encryption at rest remain deployment
prerequisites. There is no public or bearer-link sharing, and a file already
downloaded cannot be recalled.

## Destructive behavior

Exact confirmation phrases are intentionally not localized or fuzzy:

- Account: `DELETE ACCOUNT DATA`
- user: `DETACH MY USER`
- player: `PSEUDONYMIZE PLAYER`

Account execution:

- replaces current Account and player display identity in primary data;
- adds a player-level privacy overlay so accepted snapshots and every current
  report/export resolve pseudonyms;
- archives player roster relationships;
- deletes rebuildable projection checkpoints;
- disables active memberships and revokes pending invitations while clearing
  delivery contact;
- revokes and clears prepared export artifacts; and
- archives the Account.

User execution marks the application identity deleted/detached, disables all
of that user's active memberships, and revokes pending invitations addressed to
the user. The stable provider subject and historical opaque actor id remain only
to prevent accidental reprovisioning and preserve attribution; provider-side
identity deletion is an operator/provider action and is not claimed here.

Player execution replaces the current primary display name, archives its roster
relationships, adds the current privacy overlay, and invalidates projections.
It does not imply anonymity: jersey, team, game date, opponent, location, and
statistics may remain reidentifying.

Accepted setup snapshots, events, corrections, evidence, and security audits
are never edited or deleted. This preserves deterministic scoring and correction
history. Their approved display fields resolve through the new overlay, and
derived projections are rebuilt against the new privacy revision. A request
that requires removal of the remaining baseball facts cannot be silently
reported complete; it needs a new reviewed policy and migration.

## Holds, retention, backups, and recovery

An Account-wide or request-specific hold records a reason, responsible actor,
optional expiry, placement, and release. An active unexpired hold moves an
eligible request to `BLOCKED` and records a denied execution audit. Holds do not
grant access or reverse disabled authority. Only `privacy.manage` may place or
release them; indefinite holds require explicit release.

| Record                               | Baseline retention/deletion behavior                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepared export grant                | No export body is stored. Token access expires after five minutes; the verifier is cleared on download, cancellation, observed expiry, revocation, or Account execution |
| Export occurrence manifest           | Minimized restricted security audit; 13-month operational baseline, subject to approved legal schedule                                                                  |
| Privacy request/hold/audit evidence  | Retain 13 months after terminal state at minimum; longer only under recorded policy/hold                                                                                |
| Current Account/user/player identity | Replaced, detached, or disabled by successful primary-data execution as described above                                                                                 |
| Projections                          | Deleted during Account/player execution; rebuild only from effective source plus privacy revision                                                                       |
| Accepted history and security audit  | Retained append-only; never rewrite it to hide a discrepancy or privacy action                                                                                          |
| Backups                              | Daily 35 days, monthly 12 months, and any explicit hold, per `BACKUP_AND_RESTORE.md`                                                                                    |

Primary execution does not rewrite old backups. Backup lifecycle deletion limits
how long old identity may persist. Restore remains isolated until operators
reapply every privacy request/overlay after the recovery point, revoke restored
authority and artifacts, rebuild projections, and reconcile the deletion ledger.
Restored data may not serve traffic before that evidence is recorded.

## Retry, failure, and support procedure

- Retry request creation with the same idempotency key and exact body. Do not
  invent a new request when the first outcome is unknown.
- Export preparation may retry with its same key; use only the newest returned
  token. Download itself is one-time and is never replayed.
- Cancel during the seven-day window through the authenticated request route.
- If a request is blocked, operators identify the restricted hold record and
  release or expire it only with accountable approval. They never bypass it.
- On a failed execution, confirm the request is not `COMPLETED`, inspect only
  sanitized audit/correlation evidence, repair the cause, and retry the same
  request through the service worker. Serializable rollback prevents a claimed
  partial success.
- If output or identity exposure is suspected, revoke prepared artifacts,
  disable affected access, use the private security route, preserve minimized
  evidence, and follow `PRODUCTION_RELIABILITY.md`.

The representative PostgreSQL suite proves token rotation, one-time download,
expiry, cancellation, exact retry, confirmation, audit rollback, holds,
cross-boundary authorization through trusted actors, Account authority removal,
projection deletion, export revocation, pseudonymization, and retention of
accepted source history. Hosted encryption, provider identity deletion, backup
lifecycle enforcement, and legal sufficiency require environment/operator
evidence before production use.
