# Repository security audit

Audit date: 2026-08-03

Baseline: `96dc8497d2944789c3da47355206ace03dea03e1`

This audit covers application, database, integration, repository, dependency,
container, and privacy boundaries. It is an engineering review, not a legal
compliance opinion or a substitute for an external penetration test.

## Merge policy

- **Critical:** block merge.
- **High:** block merge unless the repository owner records an explicit,
  time-bounded acceptance.
- **Medium:** remediate or track in an issue with an owner and review point.
- **Low:** document; fix when the change is proportionate.

This change leaves no accepted Critical or High finding. GitHub workflow runs
are the final evidence for CodeQL and production-image scanning because the
audit workstation has no Docker daemon.

## Findings

| ID      | Severity                    | Status                       | Finding and remediation                                                                                                                                                                                                                                                                                                                       |
| ------- | --------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | High                        | Fixed                        | `fast-uri` 3.1.4 and `brace-expansion` 5.0.8 were present in the npm lockfile. The lockfile now resolves fixed releases; both full and production npm audits report zero findings.                                                                                                                                                            |
| SEC-002 | High                        | Fixed                        | Documentation heading normalization removed nested HTML-like text in one pass. Repeated removal now reaches a stable value before the strict anchor allowlist runs, with a nested-markup regression test.                                                                                                                                     |
| SEC-003 | High alert / false positive | Dismissed after confirmation | CodeQL classified the Discord OAuth-state HMAC as password hashing. The value is a random state integrity tag, not a password. Advanced CodeQL confirmed the trace ends at test-supplied signing keys; alert 1 is dismissed with that rationale. The implementation constructs an explicit secret key and rejects keys shorter than 32 bytes. |
| SEC-004 | High                        | Fixed                        | An Account-managed feed URL could redirect a server-held provider API key to another HTTPS origin. A deployment-owned `EXTERNAL_DATA_PROVIDER_ALLOWED_ORIGIN` now binds that key to one exact origin. Redirects remain disabled.                                                                                                              |
| SEC-005 | Critical/High               | Fixed                        | Debian application and Discord images inherited numerous operating-system CVEs. Both images now use digest-pinned Alpine 3.23 bases. The Node build tool upgrades npm, clears its cache, and removes npm from shipped images. CI builds and scans the final runtime, migration, and bot images, blocking fixable High or Critical findings.   |
| SEC-006 | Medium                      | Fixed                        | Dependabot omitted the Discord service's Python dependencies. Weekly pip monitoring now covers its locked requirements.                                                                                                                                                                                                                       |
| SEC-007 | Medium                      | Fixed                        | Active repository rulesets protect `main` and `v*` release tags. `main` requires pull requests, resolved conversations, current branches, `verify`, and the stable `SAST required gate`; force pushes and deletion are blocked. The SAST gate plans CodeQL by changed path so non-source pull requests do not deadlock.                       |
| SEC-008 | Low                         | Fixed                        | Security guidance still described a private repository without secret scanning or private vulnerability reporting. The documents now match live settings.                                                                                                                                                                                     |
| SEC-009 | Medium                      | Mitigated and monitored      | Reassessed 2026-09-13: cloudflared 2026.9.1 removes 11 fixable High findings, with three remaining upstream. PostgreSQL retains 24 fixable High findings in PCRE2 and gosu; the latest vendor image has the same findings. Digest pins, exposure controls, and monitoring remain in place.                                                    |

### SEC-009 upstream image review

Owner: repository security maintainer. Review cadence: weekly Dependabot image
checks and the scheduled monthly security audit, with immediate reassessment on
an upstream digest or exposure change.

Reassessed on 2026-09-13 with Trivy 0.73.0. The pinned PostgreSQL image
retains 24 High findings with upstream fixes: two in `libpcre2-8-0` and 22
in the Go 1.24.6 standard library embedded in gosu 1.19. The current
`postgres:17-bookworm` manifest (`sha256:051f7b…72e0`) has the same findings,
so replacing the existing digest would not remediate them. The latest
[gosu release](https://github.com/tianon/gosu/releases/tag/1.19) is still 1.19.
PCRE2 needs `10.42-1+deb12u1`; fixing the shipped image now would require
maintaining a derived database image, and gosu would additionally require a
vendor rebuild or a separately reviewed binary replacement. These changes are
outside this dependency cleanup's existing vendor-image deployment contract.
The full scan additionally reports 72 High and 16 Critical findings without an
available fixed version, for 112 High/Critical findings in the PostgreSQL image
overall. Counts are scanner package findings, not confirmed exploitable paths.

Cloudflare Tunnel is upgraded from 2026.7.3 to
[2026.9.1](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.1),
pinned to `sha256:b269e8…54e4`. Its Go 1.26.8 toolchain and refreshed base
remove 11 fixable High findings. Three High findings remain in the latest
vendor image: `CVE-2026-56854` (`golang.org/x/crypto` 0.53.0, fixed in
0.55.0), and `CVE-2026-84304` / `CVE-2026-84445` (gRPC 1.83.0, both fixed
in 1.83.2). No alert is dismissed and the infrastructure scans remain enabled.
The [release notes](https://github.com/cloudflare/cloudflared/blob/2026.9.1/RELEASE_NOTES)
retain the tunnel command used by Compose; live tunnel connectivity still
requires deployment credentials and was not exercised during this cleanup.

Gosu is limited to fixed local privilege-drop arguments during PostgreSQL
startup; the database has no host port and uses an internal network. The tunnel
remains an optional profile and runs non-root, read-only, without capabilities
or autoupdate. These are compensating controls, not vulnerability fixes. The
full operational status, source links, owner, upgrade procedure, and exposure
triggers are maintained in
[`CONTAINER_OPERATIONS.md`](CONTAINER_OPERATIONS.md#upstream-infrastructure-image-monitoring).

## Application review

### Authentication and sessions

OAuth adapters use server-owned endpoints, ten-second request timeouts, rejected
redirects, authorization-code flow, PKCE, state, nonce where applicable, and
strict response schemas. Provider subject, not email, is the identity key.
Identity linking requires an authenticated session and a one-time database
attempt bound to the browser. Apple identity tokens validate issuer, audience,
nonce, lifetime, key id, and signature.

Application sessions use random opaque tokens; only keyed hashes are stored.
Cookies are HTTP-only, SameSite, path-scoped, and Secure in production. Sessions
have idle and absolute expiry, rotation, replay grace, revocation, and
append-only event history. OAuth attempt secrets are AES-256-GCM encrypted and
one-time consumption is enforced transactionally.

No automatic email merge or trusted client identity claim was found.

### Authorization and Account isolation

Protected routes authenticate on the server, resolve current membership and
delegated authority, resolve the target inside the requested Account, and then
evaluate a named capability. Resource/account mismatches fail closed. Mutating
browser requests use same-origin checks; exports, imports, configuration,
privacy operations, fantasy actions, Discord administration, and API access
have focused cross-Account and denied-capability tests.

Internal worker routes compare dedicated bearer tokens in constant time. Public
API and high-cost operations have Account-aware rate limits. No UI-only
authorization decision was found.

### Input and output safety

Route, domain, provider, import, and stored-browser boundaries use strict Zod
schemas, size limits, allowlists, and generic external errors. Prisma tagged
templates or generated query methods are used; no unsafe raw-query API was
found. External HTTP calls reject redirects and enforce timeouts. The licensed
feed additionally caps response size and now binds credentials to an approved
origin.

No `dangerouslySetInnerHTML` use was found. React escaping, fixed response
content types, `nosniff`, private/no-store cache headers, and safe attachment
names cover reviewed output paths. JSON parsing is schema-validated before
trusted use.

## Database review

Migrations use foreign keys, composite Account/resource constraints, immutable
or append-only triggers for historical evidence, and bounded check constraints.
Authentication identity, session, OAuth attempt, configuration, fantasy, and
integration tables enable row-level security and revoke direct Supabase API-role
access. Trigger functions use a fixed search path and are not public RPCs.

The application connects through one server-side Prisma boundary; database URLs
remain environment-only. Transactional repositories lock rows for session
rotation, configuration revision, rate limit, webhook delivery, and other
concurrent state changes. Migration and Account-isolation integration suites
remain required CI gates.

## Integration review

- OAuth provider credentials remain server-only and callback redirects are
  exact configured values.
- Discord installation, notification, update, and statistics credentials are
  separate; OAuth state, callback ownership, guild identity, delegated
  permissions, and audit history are checked server-side.
- Webhooks use versioned HMAC signatures, bounded payloads, retry policy,
  endpoint ownership, immutable event evidence, and delivery audit records.
- External provider responses are size-bounded and schema-normalized before
  quarantine or publication. Provider credentials cannot cross their
  deployment-approved origin.

## Privacy review

The schema deliberately excludes date of birth, medical data, family contacts,
and free-form player notes. Player presentation passes through Account-scoped,
append-only privacy overlays. Exports reauthorize at download time, apply field
allowlists, use expiring opaque access tokens, and return non-cacheable data.
Imports reject authentication/secrets and quarantine ambiguous identity or
privacy state.

Operational metadata redacts keys associated with authorization, cookies,
tokens, secrets, passwords, claims, payloads, email, names, notes, birth,
contacts, and database URLs. Security audit writes remain transactional.

Browser storage contains only an install-prompt preference and versioned,
Account/game-scoped unaccepted scoring drafts. Drafts are schema-validated,
reconciled against the current Account and source revision, and cleared after
acceptance. They contain baseball event identifiers, so shared-browser and XSS
risk remains; no executable HTML sink was found. Users handling youth data
should use protected devices and browser profiles.

## Automated controls

### Main and pull-request SAST

`.github/workflows/main-push-sast.yml` provides a stable required gate for pull
requests and merge queues, with source-scoped pushes to `main` and manual
dispatch available. Its fail-safe planner calls the reusable CodeQL workflow
for Actions, JavaScript/TypeScript, and Python using the `security-extended`
suite when analyzable source or workflows change. Documentation-only changes
receive the gate without running an unnecessary CodeQL matrix. Focused security
regressions and the high-severity production npm audit remain in `verify`.

### Monthly audit

`.github/workflows/monthly-security-audit.yml` runs on the first day of each
month and by manual dispatch. Relevant security/dependency/container pull
requests also exercise it before merge. It runs:

- CodeQL SAST;
- npm and pip dependency audits;
- Trivy filesystem vulnerability, misconfiguration, and current-tree secret
  scans;
- TruffleHog verified-secret scanning across full Git history;
- builds of the application runtime, migration runner, and Discord bot; and
- Trivy final-image scans that block fixable High and Critical findings.

The same job reports all High/Critical vulnerabilities from the pinned
PostgreSQL and optional Cloudflare infrastructure images. The scan explicitly
selects the vulnerability scanner, so it does not inspect or print packaged
test-key material. These findings are observation-only because the repository
cannot patch vendor binaries: reachability is reviewed under SEC-009, exact
version-plus-digest references prevent silent changes, and Dependabot supplies
the upgrade path.

Third-party scanner binaries are pinned to explicit versions and verified with
vendor-published SHA-256 checksums. GitHub Actions are GitHub-owned and pinned
to full commit SHAs. Jobs default to read-only repository contents; only CodeQL
receives `security-events: write`. Security workflows consume no repository
secrets.

GitHub secret scanning, push protection, private vulnerability reporting,
Dependabot alerts/security updates, CodeQL, read-only default workflow tokens,
and a GitHub-owned Actions allowlist are enabled. Dependabot covers npm, pip,
Docker, and GitHub Actions.

Semgrep was evaluated but not added. CodeQL covers every repository language,
and adding a second rule/action supply chain did not justify the overlap. Trivy
and TruffleHog fill the configuration, image, and history-secret gaps.

## Verification evidence

- npm audit: 535 packages, zero known vulnerabilities after remediation.
- TruffleHog 3.96.0: 239 commits, zero verified or unverified secrets.
- Trivy 0.73.0 repository scan: zero vulnerability, misconfiguration, or secret
  findings at the audit baseline.
- GitHub Dependabot: zero open alerts.
- GitHub secret scanning: zero open alerts; push protection enabled.
- GitHub CodeQL: zero open alerts after the default-branch advanced analysis.
- Focused security regression suite: 52 tests passed.
- Repository workflow contract: passed.
- Full repository, database migration, production build, container build, and
  final-image scan results are recorded by the PR checks.

## Residual risk and follow-up

1. This review did not include dynamic production testing, provider-side
   configuration inspection, cloud IAM review, or an external penetration
   test. Complete those before accepting production youth data.
2. Trivy blocks fixable High/Critical image findings. Unfixed upstream findings
   remain visible in reports and require monthly review rather than an
   impossible build gate.
3. Rotate scanner versions deliberately and verify their checksums; Dependabot
   updates action SHAs and image digests but cannot update inline scanner
   binaries.
4. Keep SEC-009 under the documented monthly and Dependabot monitoring policy.
   Upgrade only when vendor rebuilds use the fixed Go and gRPC versions, and
   reassess immediately if either container's startup or network exposure
   changes.
