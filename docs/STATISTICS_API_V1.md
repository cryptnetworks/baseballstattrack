# Statistics read API v1

The v1 API is an authenticated, read-only boundary for web, bot, export, and
integration clients. It never accepts scoring mutations and has no anonymous
mode.

## Resources

- `GET /api/v1/accounts` lists only active Accounts available to the caller.
- `GET /api/v1/accounts/{accountId}` reads one permitted Account.
- `GET /api/v1/accounts/{accountId}/teams`
- `GET /api/v1/accounts/{accountId}/seasons`
- `GET /api/v1/accounts/{accountId}/players`
- `GET /api/v1/accounts/{accountId}/games`
- `GET /api/v1/accounts/{accountId}/games/{gameId}/box-score`
- `GET /api/v1/accounts/{accountId}/seasons/{seasonId}/leaders?teamId=…`

Every identifier in the path or response is a database-generated external UUID
or a versioned opaque snapshot reference. Internal primary, foreign, setup, and
lineage keys are not part of the contract.

Successful responses use media type
`application/vnd.baseballstattrack.stats.v1+json`, include `X-API-Version: v1`,
and have an `apiVersion` envelope field. Responses are private and `no-store`.

## Authorization and errors

Cookie sessions and Supabase bearer access tokens use the same server-side
active-user, active-membership, target-resolution, role, and exact-grant
boundary. Directories require their matching view capability; box scores and
leaders require `report.view` at the exact game or team-season scope. A URL is
only a selector and cannot create authority.

Authentication failures return 401. Unauthorized resource access returns the
same non-enumerating 403 response used by the application. Malformed paths and
filters return 400; unavailable resources return 404 only after authentication.
Rate limits use the established 429 response and `RateLimit-*`/`Retry-After`
headers. Error bodies never contain database, membership, or provider details.

## Filtering, sorting, and pagination

Directories accept:

- `limit`, from 1 through 100 (default 25);
- opaque `cursor` returned by the prior page;
- `direction=asc|desc`, which must match the cursor; and
- case-insensitive `query` for team, season, and player display names.

Games additionally accept a stable external `seasonId` filter. Ordering is by
external UUID, producing deterministic pages without putting private display
names or internal keys in cursors. Unsupported or malformed parameters are
rejected rather than ignored. Empty results are successful empty arrays.

## Freshness and correction semantics

Game summaries include report status, verification state, correction state,
source revision, projection freshness, derivation version, and privacy-overlay
revision. A checkpoint is `CURRENT` only when its status, source revision, and
derivation version match current game state. Missing derived data is
`INCOMPLETE`; a mismatched checkpoint is `STALE`.

Box scores expose current/final/terminated state, correction and verification
metadata, statistic/rules versions, reconciliation confidence, and exact
derived lines. The season leaders response also carries team record, all-player
summaries, and recent games for read-only clients; their player and game
references are external IDs and setup lineage remains private. Leaders retain
the verified-only inclusion policy. Corrected or incomplete data is labeled; it
is never silently promoted to verified data.

The v1 contract is additive-only within its major version. Removing or changing
field meaning requires a new API version. The canonical
[OpenAPI specification](api/statistics-v1.openapi.yaml), its executable
examples, and the [versioning and compatibility policy](API_VERSIONING_AND_COMPATIBILITY.md)
define the supported boundary and change process.
