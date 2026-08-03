# M8 exit audit

Audit date: 2026-08-03

M8 establishes portable, ruleset-aware baseball history and a separate fantasy
derivation domain. This audit closes the milestone implementation boundary; it
does not begin M9.

## Issue matrix

| Issue | Contract or implementation   | Evidence                                                                                     | Exit assessment                                                                                       |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| #101  | Import portability           | `IMPORT_PORTABILITY.md`, ADR 0011, validation/quarantine/replay tests                        | Complete; imports never match rules or identity by name and cannot partially promote history          |
| #106  | Ruleset contract             | `RULESET_CONTRACT.md`, ADR 0010, immutable binding tests                                     | Complete; exact family/version/digest and historical game binding preserved                           |
| #107  | League delegation            | `LEAGUE_DELEGATION_MODEL.md`, ADR 0012, authority tests                                      | Contract complete; unpersisted web adapter fails closed and is listed as a remaining operational risk |
| #123  | Fantasy domain               | `FANTASY_DOMAIN_MODEL.md`, ADR 0014, domain tests                                            | Complete; Account-owned league/team/roster entities reference canonical players only                  |
| #124  | Fantasy transactions         | `FANTASY_TRANSACTIONS.md`, ADR 0015, concurrency/idempotency/rollback tests                  | Complete; pure state machine plus #127 atomic persistence for UI mutations                            |
| #125  | Fantasy rules                | `FANTASY_RULES_CONTRACT.md`, ADR 0013, version/eligibility tests                             | Complete; immutable extensible weekly points model remains separate from baseball rules               |
| #126  | Fantasy scoring              | `FANTASY_SCORING_AND_MATCHUPS.md`, ADR 0016, deterministic replay/correction/standings tests | Complete; immutable result lineage and visible uncertainty                                            |
| #127  | Fantasy UI and notifications | `FANTASY_USER_INTERFACE_AND_NOTIFICATIONS.md`, ADR 0017, UI/notification/migration tests     | Complete for Account-authorized web presentation and delivery foundation                              |

## Architecture review

The dependency direction remains one-way:

```text
baseball rules + canonical events
              -> versioned statistics
              -> immutable fantasy rules
              -> fantasy league/roster history
              -> fantasy results
              -> Account-authorized UI and notifications
```

Canonical baseball code has no dependency on fantasy persistence, routes, or
messages. Fantasy entries reference player ids rather than duplicating player
identity. The UI consumes allowlisted presentation objects and never evaluates
scoring or authorization in the browser. Aggregate, event, result, security
audit, and notification outbox writes share explicit transactional boundaries.

## Security review

- All reads and mutations bind authenticated identity to the exact selected
  Account; all league repository lookups include Account and league identity.
- Team mutations require exact owner membership or commissioner authority.
- Same-origin action checks, strict Zod boundaries, operation ids, expected
  revisions, row locks, and append-only triggers prevent CSRF, coercion,
  duplicate effects, lost updates, and historical rewriting.
- New tables use RLS with no permissive policy and revoke `anon`,
  `authenticated`, and `service_role` direct table privileges.
- Notification payloads are strict and contain no destination, credential, raw
  event, player profile, or authority evidence.
- Exports require commissioner authority, use `private, no-store`, and apply a
  fixed privacy allowlist.

Adversarial review found no name-based identity merge, latest-version fallback,
cross-Account query, client-trusted role, mutable result row, silent score
uncertainty, or unreviewed delete path.

## Privacy review

The fantasy store excludes date of birth, age, contacts, guardians, medical
information, notes, credentials, and hidden analytics. Canonical player display
names are loaded only within the exact Account and passed through privacy
overlays. Missing names fail private. Notification destinations remain managed
references and never enter fantasy views, events, or exports. League creation
inherits only already-active recipient consent and never re-enables an opted-out
preference.

## Database and migration review

The forward migration creates Account-prefixed foreign keys and indexes,
monotonic workspace revision enforcement, append-only history triggers, result
lineage constraints, notification schedule constraints, RLS, function
`search_path` hardening, and direct API-role privilege denial. Writes use short
transactions and deterministic lock order. A migration deployment and status
check are part of the final validation record below.

## Validation record

Local validation on 2026-08-03:

- `npm run verify` passed: formatting, lint, TypeScript, 752 tests in 126
  files (82 database-dependent tests skipped without `DATABASE_URL`), policy,
  documentation, API contract, Prisma schema, production build, route budgets,
  PWA checks, and production dependency audit (zero high vulnerabilities).
- Focused authorization, replay, import, fantasy, and accessibility validation
  passed: 66 tests in eight files.
- Performance measurement passed. The 75-event replay p95 was 95.837 ms and
  9,000-record import validation p95 was 12.709 ms. The fantasy route shipped
  108,345 raw / 32,705 gzip client bytes within its 150,000 / 45,000 budgets.
- Production configuration parsing passed and a local production server returned
  the expected Account-selection redirect for unauthenticated `/fantasy`.
- Interactive in-app browser validation could not run because no browser backend
  was connected. Docker container smoke and live migration deploy/status checks
  could not run because Docker/PostgreSQL were unavailable locally. CI is the
  required merge gate for those database, container, and authenticated browser
  environment-independent checks; semantic accessibility and migration contract
  tests passed locally.

## Remaining risks

1. Automatic fantasy period calculation and scheduling are not present. A
   trusted publisher must invoke the #126 calculation and append-result service;
   the UI honestly shows unavailable/incomplete results until then.
2. #107 delegated authority is modeled and validated but the current web auth
   adapter issues direct Account authority only. Delegated web access fails
   closed until a separately reviewed persistence/adapter change.
3. The initial workspace projection loads at most 500 players and 500 recent
   result rows. Large competitions need pagination/current-result projections.
4. The initial product provisions one manager-owned team and daily waiver
   acquisition. Multi-manager invitation, team creation, and end-user trade
   negotiation need a reviewed experience built on #123/#124.
5. Notification delivery depends on a previously configured managed Account
   destination and the existing delivery worker. The fantasy UI intentionally
   cannot create or reveal destination references.

None of these risks permits silent baseball mutation, cross-Account access,
hidden uncertainty, or invented notification consent.

## M9 deferrals

M9 is not started. Deferred candidates are automatic fantasy orchestration,
cross-Account leagues, delegated web-auth persistence, large-league pagination,
manager invitations/trade negotiation, public allowlisted league metadata,
advanced fantasy formats, and offline fantasy synchronization. Each requires a
new issue and must retain all M8 identity, lineage, privacy, and authorization
invariants.
