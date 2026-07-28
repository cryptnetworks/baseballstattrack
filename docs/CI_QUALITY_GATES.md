# CI quality gates

This document defines the required local and GitHub Actions quality gates for Baseball Stat Track. It does not configure branch protection itself; repository owners must apply the documented required check once the repository plan permits protected rules for `main`.

## Canonical verification

Run the complete non-mutating quality chain from a clean checkout:

```sh
npm ci
npm run verify
```

`npm run verify` stops at the first failing command and runs, in order:

1. `npm run format` — Prettier check; it does not rewrite files.
2. `npm run lint` — ESLint.
3. `npm run typecheck` — Next.js route type generation and TypeScript checking.
4. `npm run test` — one non-watch Vitest run.
5. `npm run db:validate` — Prisma schema validation only.
6. `npm run build` — production Next.js build.
7. `npm run audit:prod` — high-or-critical production dependency audit.

The independently runnable commands above are the local reproduction commands for a failed CI step. `npm run format:write` is intentionally separate because it changes files. `npm run db:migrate`, seeding, and any destructive database command are not part of verification.

## GitHub Actions contract

`.github/workflows/ci.yml` preserves the stable workflow **CI** and one required job named **`verify`**. The exact branch-protection required check name is:

```text
verify
```

The workflow runs for pull requests targeting `main` and pushes to `main`. It uses a single combined job so contributors and branch protection share the exact canonical command. Workflow concurrency cancels obsolete runs for the same pull request or branch; it never cancels a different pull request's run.

The job uses Ubuntu, Node 24, npm's dependency cache keyed from the lockfile, `npm ci`, and `npm run verify`. The cache only accelerates download; `npm ci` remains authoritative and fails on a package-lock mismatch. The job has a 15-minute timeout and named checkout, setup, install, and verification steps so failures are visible in GitHub Actions logs. No required step uses `continue-on-error`, `|| true`, or a failure-masking pipe.

Node 24 and npm 11 or newer are the supported runtime baseline. The `actions/setup-node` Node 24 distribution supplies a compatible npm release; local contributors should use the versions in `package.json`'s `engines` field.

## Environment and secret safety

CI has read-only `contents` permission and receives no deployment, database, identity-provider, or application secrets. Fork pull requests run the same verification without secrets. `NEXT_TELEMETRY_DISABLED=1` disables framework telemetry; it is not a credential or application setting.

The application build currently does not create Prisma or Supabase clients. `prisma validate` validates the checked-in schema and does not connect to the configured datasource, run a migration, seed data, or print a database URL. The Prisma configuration's local fallback is syntactic configuration only for this command; CI does not set `DATABASE_URL` or `DIRECT_URL`, and no production URL is available to the workflow.

Future CI changes must keep PR verification fail-closed: do not add production secrets, migrations, seeds, destructive database access, or deployment steps. Preview and test environments must remain isolated as required by `PERSISTENCE_AND_TENANCY.md`.

## Dependency-audit policy

`npm run audit:prod` runs `npm audit --omit=dev --audit-level=high`. It blocks verification on high or critical vulnerabilities reachable through production dependencies. Development-only advisories are visible through a separate full `npm audit` when a maintainer needs it, but they do not block this required gate by default. This policy does not justify a breaking development-tool upgrade solely to clear a development-only advisory.

The audit contacts the npm registry. A registry/network failure is a failed verification, not a passing partial result; retry after confirming registry availability and preserve the actionable error in CI logs.

## Failure triage

Run the named failing command locally after `npm ci`. Common cases:

- Formatting: run `npm run format:write`, inspect the change, then rerun `npm run format`.
- Lint, typecheck, or tests: fix the reported file/test and rerun that command before `npm run verify`.
- Prisma validation: inspect `prisma/schema.prisma` and `prisma.config.ts`; do not run migrations merely to satisfy CI.
- Build: reproduce with `npm run build` without adding credentials. Investigate only documented build-time environment requirements.
- Audit: determine whether the advisory reaches production dependencies and remediate without broad, unrelated upgrades.

If a run is superseded by a newer commit, GitHub cancels it by design. Re-run a failed network-dependent check only after the underlying service is available; do not hide failures with automatic success fallbacks.

## Branch-protection recommendation and deferrals

When GitHub plan/settings permit it, protect `main` with required pull requests, an approving review, resolved conversations, up-to-date branches, and the exact `verify` check. Current plan limitations are recorded in `.github/branch-protection.md`; this repository does not claim that protection is already configured.

Deferred improvements include integration-test infrastructure, clean-database migration-chain checks, dependency provenance policy, action commit-SHA pinning if repository policy requires it, performance budgets, accessibility checks, and release/deployment gates.
