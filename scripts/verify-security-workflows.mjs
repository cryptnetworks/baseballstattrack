import { readFile } from "node:fs/promises";

import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const paths = {
  main: ".github/workflows/main-push-sast.yml",
  monthly: ".github/workflows/monthly-security-audit.yml",
  reusable: ".github/workflows/security-sast.yml",
};

function fail(message) {
  throw new Error(`Security workflow contract failed: ${message}`);
}

async function workflow(path) {
  const text = await readFile(new URL(path, root), "utf8");
  const value = parse(text);
  if (!value || typeof value !== "object") fail(`${path} is not valid YAML.`);
  return { text, value };
}

function includesMain(value) {
  return Array.isArray(value?.branches) && value.branches.includes("main");
}

const entries = await Promise.all(Object.values(paths).map(workflow));
const [main, monthly, reusable] = entries;

if (!includesMain(main.value.on?.push)) fail("main push trigger is missing.");
if (!includesMain(main.value.on?.pull_request))
  fail("pull-request SAST gate is missing.");
if (!("workflow_dispatch" in main.value.on))
  fail("main SAST cannot be dispatched manually.");
if (!Array.isArray(monthly.value.on?.schedule))
  fail("monthly schedule is missing.");
if (!("workflow_dispatch" in monthly.value.on))
  fail("monthly audit cannot be dispatched manually.");
if (!("workflow_call" in reusable.value.on))
  fail("SAST workflow is not reusable.");

if ("paths" in main.value.on.pull_request)
  fail(
    "pull-request SAST uses path filters and may leave its required gate pending.",
  );
const pushPaths = main.value.on?.push?.paths;
if (!Array.isArray(pushPaths) || !pushPaths.includes("**/*.ts"))
  fail("main-push SAST is not scoped to analyzable paths.");
if (pushPaths.includes("docs/**") || pushPaths.includes("package-lock.json"))
  fail("main-push SAST includes non-source-only changes.");
if (!main.value.on?.merge_group?.types?.includes("checks_requested"))
  fail("merge-queue SAST is not scoped to checks_requested.");
if (main.value.jobs?.required?.name !== "SAST required gate")
  fail("stable SAST required gate is missing.");
if (main.value.jobs?.required?.if !== "${{ always() && !cancelled() }}")
  fail("SAST required gate does not always evaluate completed plans.");
if (main.value.jobs?.sast?.if !== "needs.scope.outputs.sast == 'true'")
  fail("SAST execution is not controlled by the fail-safe path plan.");

for (const [name, entry] of Object.entries({ main, monthly, reusable })) {
  if (entry.value.permissions?.contents !== "read")
    fail(`${name} workflow does not default to read-only contents.`);
  if (entry.text.includes("secrets."))
    fail(`${name} workflow reads repository secrets.`);
  for (const use of entry.text.matchAll(/^\s*uses:\s*(\S+)/gmu)) {
    if (use[1].startsWith("./")) continue;
    if (!/@[a-f0-9]{40}$/u.test(use[1]))
      fail(`${name} workflow action is not pinned by commit: ${use[1]}.`);
  }
}

for (const language of ["actions", "javascript-typescript", "python"]) {
  if (!reusable.text.includes(`- ${language}`))
    fail(`CodeQL does not cover ${language}.`);
}
if (!reusable.text.includes("queries: security-extended"))
  fail("CodeQL security-extended queries are not enabled.");
if (
  main.text.includes("npm run security:test") ||
  main.text.includes("npm audit")
)
  fail(
    "main SAST duplicates checks already enforced by CI or dependency audit.",
  );
if (monthly.value.jobs?.sast?.if !== "github.event_name != 'pull_request'")
  fail("pull requests duplicate the scheduled SAST suite.");
if (
  monthly.value.jobs?.["repository-scan"]?.if !==
  "github.event_name != 'pull_request'"
)
  fail("pull requests duplicate the scheduled repository history scan.");
if (
  !monthly.value.jobs?.["node-dependencies"] ||
  !monthly.value.jobs?.["python-dependencies"]
)
  fail("Node and Python dependency audits are not independently scoped.");
if (!monthly.text.includes("npm audit --audit-level=high"))
  fail("npm high-severity gate is missing.");
if (!monthly.text.includes("python -m pip_audit --strict"))
  fail("Python dependency gate is missing.");
if (!monthly.text.includes("sha256sum --check"))
  fail("downloaded scanner checksums are not verified.");
if (!monthly.text.includes("trufflehog git file://. --only-verified --fail"))
  fail("verified Git-history secret gate is missing.");
if (
  !monthly.text.includes(
    "trivy image --scanners vuln --ignore-unfixed --severity HIGH,CRITICAL --exit-code 1",
  )
)
  fail("container high/critical gate is missing.");

console.log("Security workflow contract passed.");
