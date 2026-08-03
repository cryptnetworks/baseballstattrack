import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowPath = ".github/workflows/publish-docs-wiki.yml";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const source = await readFile(workflowPath, "utf8");
const workflow = parse(source);
const triggers = workflow.on;

assert(
  workflow.name === "Publish documentation wiki",
  "Wiki workflow name changed unexpectedly.",
);
assert(
  !Object.hasOwn(triggers, "pull_request"),
  "Wiki workflow must not run from pull requests.",
);
assert(
  !Object.hasOwn(triggers, "push"),
  "Wiki workflow must not publish directly from arbitrary pushes.",
);
assert(
  Array.isArray(triggers.workflow_run?.workflows),
  "Wiki workflow must wait for CI workflow_run.",
);
assert(
  triggers.workflow_run.workflows.includes("CI"),
  "Wiki workflow must wait for CI.",
);
assert(
  triggers.workflow_run.types?.includes("completed"),
  "Wiki workflow must inspect completed CI runs.",
);
assert(
  triggers.workflow_run.branches?.includes("main"),
  "Wiki workflow must be scoped to main.",
);
assert(
  workflow["permissions"]?.contents === "read",
  "Wiki workflow token permissions must remain read-only.",
);
assert(
  Object.hasOwn(triggers, "workflow_dispatch"),
  "Wiki workflow needs manual dispatch.",
);
const modeInput = triggers.workflow_dispatch.inputs?.mode;
assert(
  modeInput?.type === "choice",
  "Manual wiki mode must be a choice input.",
);
assert(
  modeInput.default === "dry-run",
  "Manual wiki publication must default to dry-run.",
);
assert(
  modeInput.options?.includes("dry-run") &&
    modeInput.options?.includes("publish"),
  "Manual mode must support dry-run and publish.",
);

const serialized = JSON.stringify(workflow);
assert(
  !serialized.includes("contents: write"),
  "Wiki workflow must not request repository write permissions.",
);
assert(
  serialized.includes("workflow_run.conclusion == 'success'"),
  "Wiki workflow must require successful CI.",
);
assert(
  serialized.includes("workflow_run.event == 'push'"),
  "Automatic wiki publication must only follow main pushes.",
);
assert(
  serialized.includes("workflow_run.head_branch == 'main'"),
  "Automatic wiki publication must require main.",
);
assert(
  serialized.includes("needs.scope.outputs.publish == 'true'"),
  "Automatic wiki publication must require a documentation change.",
);
assert(
  source.includes('git diff --name-only -z "${SOURCE_SHA}^1"'),
  "Wiki publication scope must inspect the exact main commit.",
);
assert(
  serialized.includes("docs/*") &&
    serialized.includes("scripts/publish-docs-wiki.*"),
  "Wiki publication scope must include documentation and its publisher.",
);
assert(
  serialized.includes("WIKI_PUBLISH_TOKEN"),
  "Wiki workflow must use the documented publication credential.",
);
assert(
  serialized.includes("GIT_ASKPASS") &&
    serialized.includes("GIT_TERMINAL_PROMPT"),
  "Wiki Git authentication must be non-interactive and use GIT_ASKPASS.",
);
assert(
  serialized.includes("docs:wiki:dry-run") &&
    serialized.includes("docs:wiki:publish"),
  "Wiki workflow must invoke both modes.",
);
assert(
  /git\s+.*clone/u.test(serialized),
  "Wiki workflow must use a temporary cloned publication target.",
);
assert(
  !/echo[^\n]*\$\{WIKI_PUBLISH_TOKEN\}/iu.test(source),
  "Wiki workflow must not print the wiki credential.",
);
assert(
  !/Authorization:\s*Bearer/iu.test(source) &&
    !/http\.extraheader/iu.test(source),
  "Wiki Git authentication must not use an unsupported Bearer header.",
);

console.log("Documentation wiki workflow boundary passed.");
