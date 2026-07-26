# Contributing

## Before starting

1. Read the linked issue and confirm its acceptance criteria.
2. Keep each change focused on one issue or one coherent slice of work.
3. Do not introduce a framework or persistence technology without documenting the decision.
4. For scoring logic, add or update deterministic domain tests.

## Branches and pull requests

Use short-lived branches with prefixes feat/, fix/, chore/, and docs/. Include the issue number in the branch name. Open a pull request into main and link the issue with Closes #N when the change fully resolves it.

Every pull request should explain:

- what changed and why;
- how it was verified;
- migrations or operational changes;
- known follow-up work.

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
- Database migration: `npm run db:migrate`

## Decisions

Record durable architecture decisions under docs/decisions/ using the template in issue #1 once the repository stack is selected.

## Code quality

Use strict typing, input validation at boundaries, small cohesive modules, and explicit error handling. Avoid speculative abstractions and placeholder implementations.
