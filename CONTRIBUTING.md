# Contributing

## Before starting

1. Read the linked issue and confirm its acceptance criteria.
2. Keep each change focused on one issue or one coherent slice of work.
3. Do not introduce a framework or persistence technology without documenting the decision.
4. For scoring logic, add or update deterministic domain tests.

## Branches and pull requests

Use short-lived branches with prefixes feat/, fix/, chore/, and docs/. Include the issue number in the branch name. Open a pull request into main and link the issue with Closes #N when the merge itself fully resolves it.

Every pull request should explain:

- what changed and why;
- how it was verified;
- migrations or operational changes;
- known follow-up work.

Defects follow [docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md](docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md). Use the bug issue form for ordinary defects that are safe to discuss. Never put suspected vulnerability or privacy-exposure details in an issue; use [SECURITY.md](SECURITY.md).

A regression fix must include a durable automated test that fails before the fix and passes afterward. If automation is infeasible, the pull request must state why, give a concrete manual verification procedure, name an owner for future automation, and link a follow-up issue. A merged patch is not verification: defect-fix pull requests use `Refs #N`, not `Closes #N`, and the defect remains open until the merged commit is checked against the original reproduction and the evidence is recorded on the issue.

## Definition of done

A change is complete when acceptance criteria are met, tests cover important behavior, documentation is updated, security and accessibility implications are considered, and the pull request has passed the required `verify` CI check and review.

## Required commands

- Install: `npm ci`
- Format: `npm run format`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test`
- Integration tests: not yet configured
- Full verification: `npm run verify`
- Production build: `npm run build`
- Production dependency audit: `npm run audit:prod`
- Database migration: `npm run db:migrate`
- Container configuration: `npm run container:config`
- Container build and smoke test: `npm run container:verify`

Use [docs/CI_QUALITY_GATES.md](docs/CI_QUALITY_GATES.md) for the canonical `npm run verify` chain, CI behavior, and local failure triage.
Maintainers use
[docs/REPOSITORY_OPERATIONS_CHECKLIST.md](docs/REPOSITORY_OPERATIONS_CHECKLIST.md)
for issue intake, pull requests, migrations, releases, incidents, emergency
changes, and deprecations from clean checkout through post-merge evidence.

The `docs/` directory is the authoritative documentation source. Changes to
published documentation should be reviewed in this repository; the generated
wiki is not a second source of truth. Run `npm run docs:wiki:validate` for
manifest, Markdown, link, anchor, visibility, and navigation checks. Use the
documented dry-run workflow before any controlled wiki publication.

Changes to the Dockerfile, Compose configuration, runtime startup, readiness, or migration workflow must also pass `npm run container:verify`. Use [docs/CONTAINER_OPERATIONS.md](docs/CONTAINER_OPERATIONS.md) as the canonical container and operations contract.

## Decisions

Record durable architecture decisions under docs/decisions/ using the template in issue #1 once the repository stack is selected.

For changes that collect, expose, export, log, restore, or otherwise handle player/account data, follow [docs/PRIVACY_AND_THREAT_MODEL.md](docs/PRIVACY_AND_THREAT_MODEL.md).

## Code quality

Use strict typing, input validation at boundaries, small cohesive modules, and explicit error handling. Avoid speculative abstractions and placeholder implementations.
