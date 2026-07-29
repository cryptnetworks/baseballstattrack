# Defect triage and regression policy

This is the canonical process for reporting, reproducing, classifying, prioritizing, assigning, fixing, reviewing, verifying, and closing defects in Baseball Stat Track. It applies to application behavior, domain replay, persistence, migrations, authorization, privacy, accessibility, documentation, CI, and container or operational behavior.

The scoring, persistence, authorization, privacy, and CI contracts remain authoritative. A defect workflow may not weaken append-only accepted history, deterministic replay, Account isolation, server-side authorization, privacy minimization, migration safety, or the required `verify` check.

## Defect and non-defect taxonomy

| Classification                        | Definition and route                                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product defect                        | Implemented behavior violates an accepted user requirement or documented product contract. Use the bug form when safe.                                                                 |
| Regression                            | Behavior that worked in a known earlier version no longer works, or a previously fixed defect recurs. Apply the regression evidence rule below.                                        |
| Security vulnerability                | A weakness that may permit unauthorized access, code execution, injection, secret disclosure, privilege escalation, abuse, or control bypass. Report privately under `SECURITY.md`.    |
| Data-integrity defect                 | Authoritative data is lost, duplicated, corrupted, misattributed, or cannot be deterministically reconstructed. Treat replay and accepted-history impact as potentially high severity. |
| Privacy defect                        | Personal, youth, Account, export, backup, log, or telemetry data is collected, exposed, retained, or rendered contrary to the privacy contract. Route suspected exposure privately.    |
| Reliability defect                    | The system fails, hangs, retries incorrectly, loses availability, or produces nondeterministic behavior under expected operation.                                                      |
| Performance defect                    | Measured latency, resource use, throughput, or responsiveness violates an accepted budget or makes a supported workflow impractical. Include measurements and environment.             |
| Accessibility defect                  | A supported workflow is not perceivable, operable, understandable, or robust for affected users, including keyboard or assistive-technology failures.                                  |
| Documentation defect                  | Repository or product documentation is materially wrong, incomplete, unsafe, or gives commands that do not work.                                                                       |
| Enhancement request                   | Desired behavior was never accepted or implemented. Reclassify to `type:feature` or `type:task`; do not call it a defect to increase urgency.                                          |
| Expected behavior or support question | Behavior matches the current contract or the reporter needs usage help. Explain the contract and close with evidence or route to an appropriate discussion channel when one exists.    |

One issue may have more than one defect classification. Name the primary classification and record secondary impacts. Security or privacy exposure always controls routing even when another classification also applies.

## Safe report evidence

Every normal defect report captures:

- a concise title;
- affected environment;
- exact application version, deployment, or commit when known;
- expected behavior;
- actual behavior;
- ordered reproduction steps;
- the minimum reproduction, or why it cannot be reduced;
- reproducibility rate;
- safe screenshots, logs, and exact error messages when useful;
- browser, runtime, operating system, device, database, or container context where relevant;
- required data setup;
- Account or tenant context using synthetic or redacted identifiers only;
- whether real user or youth data was involved, without including that data;
- affected users, frequency, and functional, data, accessibility, or operational impact;
- any safe workaround;
- first-known-good and first-known-bad versions when known;
- whether a regression is suspected or confirmed;
- related issues, pull requests, or suspected introducing changes;
- confirmation that secrets and private or personal data were removed.

Unknown evidence is recorded as `unknown`, not invented. A triager requests the smallest missing fact that can change classification or priority. Minor documentation or cosmetic defects may use a compact reproduction, but expected and actual behavior, impact, and a safe verification path remain required.

### Artifact safety

Issue bodies, comments, attachments, test fixtures, pull requests, CI logs, and screenshots must not contain:

- real youth data or player names;
- unredacted email, phone, or contact information;
- access, refresh, invitation, recovery, or session tokens;
- cookies, passwords, MFA secrets, service credentials, or database URLs;
- invitation or recovery links;
- production dumps, backup contents, or exported private reports;
- raw private event payloads or security-audit contents;
- private notes, medical, injury, behavioral, family, or eligibility information.

Use deterministic synthetic fixtures and scoped opaque identifiers. Redaction must remove the value, not merely cover it visually while retaining it in image metadata or copied text. If safe evidence cannot be produced, route privately and describe the constraint without uploading the artifact.

## Security and privacy screening

Before ordinary triage, ask whether the report could involve:

- authentication or authorization bypass;
- cross-Account reads, writes, cache keys, projections, exports, jobs, or restore data;
- exposed secret, token, cookie, database URL, invitation, or recovery link;
- exploitable injection or unsafe dependency behavior;
- real youth or other personal-data exposure;
- backup, production dump, private event, audit, or private-report exposure;
- active abuse or exploitation;
- unpublished vulnerability details.

If yes or uncertain, stop public/repository issue discussion, preserve only safe coordination metadata, and follow `SECURITY.md`. Do not request public exploit severity, proof-of-concept code, affected Account ids, or sensitive evidence.

As of July 29, 2026, the repository is private and GitHub's public-repository private vulnerability reporting/advisory path is not available or verifiably enabled for it. The supported private route is the repository owner's **Email me!** link at `https://mdesocio.com/#hero`. No repository security email address or response-time SLA is claimed. If that link is unavailable, wait for a maintainer-controlled private channel; do not disclose details in an issue.

## Reproduction states

The triager records exactly one current reproduction state in a structured issue comment:

| State                            | Meaning and next action                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `needs reproduction`             | Evidence is not yet sufficient. Keep open, request the minimum missing information, and normally use `status:needs-review`.                                  |
| `reproducible`                   | A maintainer or test reproduces the behavior with a safe deterministic procedure. Record environment and version.                                            |
| `intermittent`                   | Reproduced nondeterministically. Record attempts, successes, timing, and suspected conditions without overstating certainty.                                 |
| `cannot reproduce`               | The stated procedure does not reproduce in the tested environment. Record attempts and version; request one bounded follow-up before closure when practical. |
| `duplicate`                      | Another issue owns the same root behavior. Link the canonical issue and close with GitHub's duplicate reason.                                                |
| `expected behavior`              | The current contract requires the result. Link the contract, explain the mismatch, and close as not planned when no change is accepted.                      |
| `blocked by missing information` | A named required fact cannot currently be obtained. State what unblocks it and use `status:blocked` only for a genuine external block.                       |
| `fixed pending verification`     | A patch is merged, but merged-commit verification has not completed. Keep the defect open and normally use `status:needs-review`.                            |
| `verified`                       | The merged commit passes the original reproduction and required regression evidence in the relevant environment. Record evidence before closure.             |
| `closed`                         | Verification is complete, or a documented duplicate/expected/cannot-reproduce decision supports closure.                                                     |

GitHub labels do not currently model every reproduction state. Do not pretend they do. Use the issue comment as the durable state record and align existing planning labels as described in `.github/label-taxonomy.md`.

## Triage record

Use this compact issue comment after intake and whenever the decision materially changes:

```text
Classification:
Reproduction state:
Affected version/environment:
Severity:
Priority:
Security/privacy screening:
Owner:
Target milestone:
Evidence or blocker:
Next action:
Decision rationale:
```

The reporter supplies evidence. The triager owns initial screening and classification. The assigned engineer owns root-cause and fix evidence. A named verifier owns merged-commit verification; the author may verify low-risk defects, while S0/S1 and authorization, privacy, migration, or data-integrity defects should receive independent verification when another maintainer is available.

## Severity

Severity measures actual or credible impact independently of scheduling priority. Assign the highest level supported by evidence and state assumptions. Severity can rise or fall when impact scope, exploitability, data loss, affected versions, workaround quality, or reproducibility changes; record the reason and prior value.

| Level           | Meaning and examples                                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S0 — critical` | Cross-Account data exposure; authentication bypass; destructive corruption of authoritative event history; widespread inability to score games; exposed production secret; active exploitation; unrecoverable production data loss. Stop routine handling and use security/incident routing where applicable.                       |
| `S1 — high`     | Serious but bounded data-integrity failure; deterministic replay divergence; incorrect verified statistics affecting many games; a common scoring workflow blocked; private player information exposed to an unauthorized authenticated user; repeated duplicate accepted plays; migration failure with material production impact. |
| `S2 — moderate` | Meaningful incorrect behavior with a workable mitigation; isolated calculation defect; noncritical workflow break; intermittent save/retry issue without loss; accessibility failure blocking a subset of users.                                                                                                                    |
| `S3 — low`      | Cosmetic issue; minor documentation error; low-impact usability issue; edge-case display inconsistency without data or workflow loss.                                                                                                                                                                                               |

The scale does not replace a security assessment, and reporters are not asked to classify exploit severity publicly. Severity labels are not currently materialized; record the value in the triage comment. Recommended future label names are documented in `.github/label-taxonomy.md`.

## Priority

Priority controls scheduling and remains separate from severity:

| Priority                 | Scheduling intent                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `P0 — immediate`         | Interrupt normal work; contain, mitigate, and fix or deliberately disable affected behavior. |
| `P1 — next planned work` | Address in the next active work window or before the affected milestone/release proceeds.    |
| `P2 — normal backlog`    | Schedule through normal planning based on dependencies and capacity.                         |
| `P3 — deferred`          | Keep documented but defer until a stated trigger, dependency, or opportunity.                |

Choose priority from severity, affected users, frequency, workaround, milestone risk, release timing, exploitability, data integrity, implementation cost, and dependency order. Cost may influence sequencing but does not reduce impact severity. A high-severity defect must not silently receive P2/P3: write the containment, workaround, owner, review date or trigger, and rationale. Use the existing `priority:p0` through `priority:p3` labels only after triage.

## Regression evidence rule

Every fixed regression includes one of:

1. a durable automated regression test; or
2. a written explanation of why automation is infeasible, a concrete repeatable manual verification procedure, a named owner for future automation, and a linked follow-up issue.

The test should fail for the demonstrated defect before the fix and pass after it. It should exercise a public contract, user-visible behavior, or meaningful invariant rather than snapshotting an accidental implementation detail.

Use the strongest appropriate evidence:

- database defects: database-level constraints or integration verification where appropriate;
- migration defects: clean-chain application plus the populated-data path and roll-forward behavior;
- event/replay defects: repeated deterministic replay, correction, revision, and evidence checks;
- statistics defects: independently derived expected results and reconciliation;
- authorization defects: denied-path, cross-Account, stale-membership, and non-enumeration tests;
- privacy defects: allowlist, redaction, omitted-field, log, and artifact assertions;
- CI/workflow defects: a controlled failing condition that proves the gate fails closed, followed by the passing fix;
- UI defects: unit, integration, accessibility, browser, or explicit manual evidence appropriate to the failure.

The rationale exception is not “too hard” or “not enough time.” It identifies the missing harness or uncontrollable boundary, preserves a manual procedure, names an owner, and creates trackable future work. A flaky test is not durable evidence.

## Fix workflow

1. **Intake:** capture the safe required evidence and link related work.
2. **Security screening:** route suspected vulnerability or privacy exposure privately before requesting detail.
3. **Reproduction:** reproduce against the named version/environment or record the bounded blocker.
4. **Classification:** select primary/secondary defect types, reproduction state, severity, and priority independently.
5. **Assignment:** name one owner, verifier, next action, and target milestone or backlog reason.
6. **Root-cause analysis:** explain the violated contract and why existing controls did not catch it; do not confuse the symptom with the cause.
7. **Regression-test creation:** demonstrate a failing test first, or document the complete exception.
8. **Minimal fix:** change the smallest coherent boundary that restores the contract without rewriting accepted history or unrelated architecture.
9. **Adversarial review:** inspect nearby invariants, denied paths, tenant boundaries, privacy fields, migrations, replay, accessibility, and failure behavior as applicable.
10. **Local validation:** run the repository definition of done plus focused reproduction and failure-path checks.
11. **PR publication:** link the defect with `Refs #N` rather than an automatic closing keyword, then record reproduction, root cause, regression evidence, verification plan, security/privacy impact, and operational recovery.
12. **CI:** require the exact current PR head to pass `verify`; never mask a failing step.
13. **Verification:** after merge, test the merged commit against the original reproduction in the relevant environment and check nearby behavior.
14. **Closure:** record verification evidence on the issue, then close. A merge alone is not verification.
15. **Systemic follow-up:** create a focused issue when the root cause exposes a missing shared guard, test harness, migration check, observability control, or process improvement.

P0/S0 work may compress documentation during active containment, but it does not omit evidence, safe routing, root-cause follow-up, regression proof, or merged-commit verification.

## Pull request and review requirements

A defect-fix pull request completes the defect section of `.github/PULL_REQUEST_TEMPLATE.md`:

- linked defect using `Refs #N`, not `Closes #N`, so verification controls closure;
- original reproduction;
- root cause and violated contract;
- durable regression test, or the complete rationale exception;
- local and CI validation;
- merged-commit verification plan and verifier;
- security, privacy, accessibility, migration, rollback, roll-forward, or recovery implications;
- intentionally deferred systemic follow-up.

Reviewers confirm that the test catches the behavior, the fix is minimal, the original reproduction is addressed, and nearby invariants remain intact. For migrations, accepted event history, authorization, privacy, or cross-Account behavior, review the failure and denied paths—not only the happy path.

## Post-merge verification and closure

Do not close a defect solely because a patch merged. Before closure:

- identify the merged commit;
- rerun the original reproduction against that commit;
- record the relevant environment and data setup;
- confirm expected behavior and the regression-test result;
- inspect at least one nearby behavior likely to regress;
- record any migration, rollout, restart, cache, projection, or container condition;
- add a concise issue comment with evidence and verifier;
- close only when the result is `verified`.

Automatic closing keywords are prohibited in defect-fix pull requests because they close the issue at merge time before this evidence exists. If an issue closes accidentally, reopen it and set `fixed pending verification` until the verification comment is complete.

If verification fails, reopen or keep the issue open, restore `reproducible` or `intermittent`, link the failed commit/PR, and choose rollback, feature disablement, containment, or a new minimal fix according to impact. Do not delete failed evidence or edit accepted migration/event history to hide the result.

## Scenario routing checks

| Scenario                          | Expected route and evidence                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary UI bug                   | Bug form; expected/actual behavior, browser/device, safe reproduction, impact, accessibility check, and appropriate UI test or manual exception.                           |
| Replay divergence                 | Data-integrity/reliability defect, normally S1; deterministic fixture, source revision/ruleset, repeated replay proof, correction/evidence checks. No raw private payload. |
| Cross-Account data exposure       | Stop issue submission and report privately under `SECURITY.md`; no Account ids, payloads, or exploit details in issues.                                                    |
| Production secret exposure        | Stop issue submission, report privately, rotate/revoke and contain through incident handling; never paste the secret.                                                      |
| Incorrect statistic               | Safe synthetic fixture, independently derived expected line/totals, affected verified-game scope, ruleset and derivation version.                                          |
| Migration regression              | Clean and populated migration paths, affected schema version, locking/data impact, idempotent roll-forward or recovery evidence.                                           |
| Intermittent duplicate submission | Attempt/success rate, idempotency scope, expected revision, concurrency conditions, no raw payload, and deterministic concurrent test where possible.                      |
| Accessibility defect              | Supported browser/assistive technology, exact blocked task, keyboard/semantic evidence, and regression test or concrete manual procedure.                                  |
| Documentation defect              | Exact command or statement, expected source of truth, corrected link/text, and verification from a clean checkout where relevant.                                          |

## Policy maintenance

The bug form, security route, pull-request template, label taxonomy, contributing guidance, and this document are one process. `npm run policy:validate` checks their syntax and core safety invariants. Maintainers review the private-reporting limitation whenever repository visibility or GitHub plan/settings change and update `SECURITY.md` before replacing the fallback.

This policy does not promise that all regressions can be prevented, claim legal compliance, enable production incident response, or complete M4 release hardening. It makes defect handling executable with the repository's current tooling.
