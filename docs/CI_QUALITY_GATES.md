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
5. `npm run policy:validate` — defect-policy issue-form YAML, required process files, safety invariants, and internal links.
6. `npm run db:validate` — Prisma schema validation only.
7. `npm run build` — production Next.js build.
8. `npm run audit:prod` — high-or-critical production dependency audit.

The independently runnable commands above are the local reproduction commands for a failed CI step. `npm run format:write` is intentionally separate because it changes files. `npm run db:migrate`, seeding, and any destructive database command are not part of verification.

## GitHub Actions contract

`.github/workflows/ci.yml` preserves the stable workflow **CI** and one required job named **`verify`**. The exact branch-protection required check name is:

```text
verify
```

The workflow runs for pull requests targeting `main` and pushes to `main`. It uses a single combined job so contributors and branch protection share the exact canonical command. Workflow concurrency cancels obsolete runs for the same pull request or branch; it never cancels a different pull request's run.

The job uses a GitHub-hosted Ubuntu runner, Node 24, npm's dependency cache keyed from the lockfile, `npm ci`, a disposable PostgreSQL 17 service, the complete migration chain, and `npm run verify`. The cache only accelerates download; `npm ci` remains authoritative and fails on a package-lock mismatch. The migration step runs deploy, status, catalog verification, and the transaction-scoped relational representability proof against the empty CI database, so invalid SQL, unapplied migrations, missing database-only constraints, and lossy representative mappings fail before application verification. The job has a 30-minute timeout and named checkout, setup, install, migration, and verification steps so failures are visible in GitHub Actions logs. No required step uses `continue-on-error`, `|| true`, or a failure-masking pipe.

Authentication and Account-isolation tests run in this same job. Because the
migration chain is applied first, current membership, scoped role and grant,
revocation, and cross-Account database tests run against disposable PostgreSQL
instead of being skipped.

Node 24 and npm 11 or newer are the supported runtime baseline. The `actions/setup-node` Node 24 distribution supplies a compatible npm release; local contributors should use the versions in `package.json`'s `engines` field.

## Environment and secret safety

CI has read-only `contents` permission and receives no deployment, identity-provider, production database, or application secrets. Its PostgreSQL credentials are fixed, workflow-local values for the isolated disposable service. Fork pull requests run the same verification without repository secrets. `NEXT_TELEMETRY_DISABLED=1` disables framework telemetry; it is not a credential or application setting.

The application build currently does not create Prisma or Supabase clients. `prisma validate` validates the checked-in schema without changing data. CI sets `DATABASE_URL` only to its disposable service so `prisma migrate deploy` can execute the checked-in chain. The representability script uses fixed synthetic identifiers inside a transaction and always rolls it back; it is not a seed. No production URL is available to the workflow.

Future CI changes must keep PR verification fail-closed: do not add production secrets, production database access, seeds, destructive access outside the disposable CI database, or deployment steps. Preview and test environments must remain isolated as required by `PERSISTENCE_AND_TENANCY.md`.

## Dependency-audit policy

`npm run audit:prod` runs `npm audit --omit=dev --audit-level=high`. It blocks verification on high or critical vulnerabilities reachable through production dependencies. Development-only advisories are visible through a separate full `npm audit` when a maintainer needs it, but they do not block this required gate by default. This policy does not justify a breaking development-tool upgrade solely to clear a development-only advisory.

The audit contacts the npm registry. A registry/network failure is a failed verification, not a passing partial result; retry after confirming registry availability and preserve the actionable error in CI logs.

## Failure triage

Run the named failing command locally after `npm ci`. Common cases:

- Formatting: run `npm run format:write`, inspect the change, then rerun `npm run format`.
- Lint, typecheck, or tests: fix the reported file/test and rerun that command before `npm run verify`.
- Defect-policy validation: inspect the named issue form, security route, process invariant, or internal documentation link; do not weaken a safety assertion merely to pass the check.
- Prisma validation: inspect `prisma/schema.prisma` and `prisma.config.ts`; do not run migrations merely to satisfy CI.
- Migration/representability: reproduce only against an isolated disposable PostgreSQL database; inspect the named constraint or synthetic invariant before changing a migration.
- Build: reproduce with `npm run build` without adding credentials. Investigate only documented build-time environment requirements.
- Audit: determine whether the advisory reaches production dependencies and remediate without broad, unrelated upgrades.

If a run is superseded by a newer commit, GitHub cancels it by design. Re-run a failed network-dependent check only after the underlying service is available; do not hide failures with automatic success fallbacks.

## Branch-protection recommendation and deferrals

When GitHub plan/settings permit it, protect `main` with required pull requests, an approving review, resolved conversations, up-to-date branches, and the exact `verify` check. Current plan limitations are recorded in `.github/branch-protection.md`; this repository does not claim that protection is already configured.

Deferred improvements include broader database integration tests, dependency provenance policy, action commit-SHA pinning if repository policy requires it, performance budgets, accessibility checks, and release/deployment gates.
