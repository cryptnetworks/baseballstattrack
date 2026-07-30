# Data export and import validation

## Scope and initial policy

Issue #26 implements:

- an authenticated, Account-scoped, full-fidelity JSON download;
- a canonical versioned manifest and deterministic encoding;
- a separately authorized import-validation and dry-run endpoint;
- replay and derived-summary comparison for every accepted game;
- safe audit records for successful exports and import-validation outcomes.

The initial import mode is deliberately `DRY_RUN_ONLY`. It performs no baseball
data mutation and exposes no confirmation or commit endpoint. A later import
commit must consume the validated plan, require a new explicit confirmation and
fresh authorization, remap logical identifiers, and promote all records in one
bounded transaction or a separately approved staged design. This boundary
proves that a failed import cannot partially corrupt the target Account without
pretending that production import promotion is already supported.

Print HTML is not an export format. Anonymous links, hosted artifacts, bearer
tokens, arbitrary Account transfer, ZIP input, CSV archival export, and
background import jobs are not implemented.

## HTTP boundaries

### Export download

`GET /api/data/export?accountId=…`

- authenticates the current session;
- authorizes exact Account-scoped `report.export` before generation;
- rebuilds accepted histories and summaries from current source;
- records a successful restricted audit before returning bytes;
- reauthenticates and reauthorizes immediately before download;
- returns `application/json; charset=utf-8`;
- sets a server-generated attachment filename;
- sets private `no-store`, `nosniff`, and no-index headers; and
- retains no hosted artifact.

Because the response is generated and streamed in one authorized request,
there is no server-side expiry or cleanup object. The artifact is ephemeral.
Once a user downloads a file, it cannot be recalled.

### Import validation

`POST /api/data/import/validate?accountId=…`

- requires same-origin request validation;
- authenticates the current session;
- authorizes exact Account-scoped `account.manage`;
- preflights `Content-Length` before buffering and rechecks the byte limit;
- validates UTF-8, JSON, manifest, schema, references, ownership, duplicates,
  event history, corrections, replay, and summaries;
- checks target logical-ID conflicts;
- returns a deterministic mutation-free dry-run plan; and
- audits safe success or failure metadata.

`report.export` does not imply `account.manage`; export and import validation
are intentionally separate privileges. URL identifiers remain selectors rather
than authorization evidence.

## Canonical format

The primary format is UTF-8 JSON:

```json
{
  "manifest": {
    "format": "baseballstattrack.account-export",
    "version": 1,
    "encoding": "utf-8",
    "exportedAt": "2026-07-30T20:00:00.000Z",
    "logicalAccount": "current-authorized-account",
    "includedEntityTypes": [],
    "counts": {},
    "checksum": "sha256:…",
    "checksumPurpose": "accidental-corruption-detection"
  },
  "data": {}
}
```

Object keys and entity arrays use deterministic ordering. A trailing newline is
included. The SHA-256 digest covers canonicalized `data`; it detects accidental
corruption and is not a signature or authenticity claim. No signing key or key
management exists.

The logical Account marker is constant. The source database Account ID is never
included. Stable entity and event IDs are portable logical references required
to preserve internal relationships. The initial dry run rejects target
conflicts rather than silently overwriting or applying last-write-wins.

## Entity allowlists

| Entity          | Included fields                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team            | logical ID, privacy-safe display name, status, archived state                                                                                                                                             |
| Season          | logical ID, display name, date boundaries, status, archived state                                                                                                                                         |
| Team-season     | logical ID, team and season references, archived state                                                                                                                                                    |
| Player          | logical ID, current privacy-resolved display name, batting side, throwing hand, archived state                                                                                                            |
| Roster          | logical ID, player/team-season references, jersey, primary position, status, effective dates, archived state                                                                                              |
| Ruleset         | logical ID, name, version, allowlisted scheduled-innings/lineup-size/defensive-only configuration, status                                                                                                 |
| Game            | logical references, scheduled time, lifecycle, source revision                                                                                                                                            |
| Accepted setup  | setup revision, ruleset, innings, side lineups and starting pitchers                                                                                                                                      |
| Event           | canonical baseball event identity, order, version, timing, body, and portable evidence; source actor/transaction/idempotency fields are replaced during validation by deterministic non-user placeholders |
| Correction      | canonical `CorrectionApplied` event and its target/replacement graph                                                                                                                                      |
| Derived summary | source/derivation versions, lifecycle/verification/outcome, score, and batting/pitching/fielding/team lines                                                                                               |

Historical team and lineup display fields use the current effective privacy
overlay. Current player identity uses the latest player-level overlay. Overlay
administrative records, reasons, actors, and replaced values are not exported.
Portable state evidence is deterministically rebuilt under a constant logical
Account marker; importing into a target Account will require new target-scoped
evidence during a future atomic promotion.

Explicitly excluded:

- source Account, membership, actor, user, provider, and infrastructure IDs;
- emails, contacts, invitations, sessions, recovery material, and tokens;
- database URLs, credentials, secrets, backup metadata, and audit internals;
- private/free-form notes or correction explanations;
- raw database rows, play-transaction idempotency material, and raw transport
  payloads; and
- historical names superseded by a privacy overlay.

The validator recursively rejects prohibited ownership/sensitive keys even when
the surrounding JSON is otherwise syntactically valid.

## Limits and encoding

- maximum encoded file size: 5 MiB;
- maximum combined entity/event records: 10,000;
- maximum scheduled innings in one setup: 30;
- bounded identifiers, names, rosters, lineups, and game collections;
- UTF-8 only, decoded with fatal invalid-sequence handling;
- JSON only; no compression or archive extraction.

Because ZIP/tar input is unsupported, decompression bombs, archive path
traversal, and remote-resource fetching are absent from the attack surface.
An oversized or invalid document fails before a plan is returned.

## Spreadsheet safety

JSON is the full-fidelity archival format. CSV is not exposed by the HTTP
boundary. The shared `neutralizeSpreadsheetCell` rule is nevertheless tested
for any future limited CSV reporting surface. Values whose first effective
character is `=`, `+`, `-`, or `@`—including after leading control
characters—receive a leading apostrophe. Ordinary values remain unchanged.
HTML escaping is not treated as formula-injection protection.

## Validation phases

The dry run performs:

1. encoded byte-size check;
2. fatal UTF-8 decoding;
3. JSON parsing;
4. explicit format/version validation;
5. strict manifest and section schemas;
6. prohibited ownership/sensitive-key scan;
7. checksum and declared-count validation;
8. record-count limit;
9. duplicate ID checks within and across sections;
10. existing target-ID conflict lookup;
11. team, season, roster, ruleset, setup, game, and event references;
12. supported event-schema parsing;
13. contiguous sequence/revision and before/after evidence validation;
14. correction-graph validation through canonical effective replay;
15. deterministic replay of every accepted history;
16. fresh batting, pitching, fielding, team, score, outcome, lifecycle, and
    verification derivation;
17. exact canonical comparison with each included summary; and
18. a deterministic dry-run plan with `mutationCount: 0`.

A syntactically valid document with invalid baseball semantics is rejected.
Included summaries are never trusted as authority.

## Ownership and duplicate policy

The only supported target is the currently authorized Account. The logical
source Account marker is remapped conceptually to that target for the dry run.
Any literal `accountId` field is rejected. Cross-Account transfers and imports
that claim a different Account are unsupported.

Duplicate IDs in a file, duplicate event IDs, missing references, and any
existing target logical ID are explicit failures. Event sequence/revision
collisions and correction conflicts fail replay. There is no silent merge,
overwrite, skip, or last-write-wins path.

## Atomicity, retries, and errors

Validation and dry run never mutate teams, seasons, players, rosters, games,
setups, events, corrections, or projections. Failure therefore leaves the
source and target baseball data unchanged. Only a minimized security-audit
outcome is written; if that required audit write fails, the operation fails
closed.

The same target Account and document checksum produce the same plan. Validation
does not reserve IDs or make a future commit idempotency claim. Future commit
design must define a confirmation token, exact retry semantics, timeout,
cancellation, cleanup, and one bounded serializable transaction or staged
atomic promotion.

Errors contain a stable code and, where safe, only section, logical record ID,
or field location. They never echo a full source row, event body, display name,
secret, or raw uploaded document.

## Round-trip proof

Synthetic fixtures normalize an accepted setup and history into the portable
logical Account, export it, validate and replay it in the dry-run pipeline,
rederive statistics, and compare:

- source and derivation versions;
- lifecycle and verification state;
- outcome and score;
- batting lines;
- pitching lines;
- fielding lines;
- team totals; and
- correction count/graph through effective replay.

The fixture also proves deterministic ordering/checksum, exact retry, secret
absence, formula defense, malformed and oversized rejection, ownership and
duplicate rejection, existing-record conflict, replay failure, summary drift,
and zero baseball-data mutations after failure.

## Retention and unsupported scenarios

The server retains no generated file. Audit records contain only checksum,
byte/count totals, outcome, dry-run mode, and safe reason code. Diagnostic logs
must not contain export contents or uploaded rows.

Unsupported until a separately reviewed follow-up:

- import confirmation and database promotion;
- arbitrary or administrative cross-Account transfer;
- record overwrite, merge, or conflict-resolution UI;
- hosted download URLs or public sharing;
- CSV as the archival format;
- compression, encryption, signatures, or authenticity verification;
- large background jobs; and
- imports from unversioned legacy formats.
