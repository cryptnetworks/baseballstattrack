import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/label-taxonomy.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md",
];

const read = async (relativePath) =>
  readFile(path.join(root, relativePath), "utf8");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
}

const parseYaml = async (relativePath) => {
  const document = parseDocument(await read(relativePath), {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new Error(
      `${relativePath} is invalid YAML:\n${document.errors.join("\n")}`,
    );
  }

  return document.toJS();
};

const bugForm = await parseYaml(".github/ISSUE_TEMPLATE/bug_report.yml");
const issueConfig = await parseYaml(".github/ISSUE_TEMPLATE/config.yml");
const securityPolicy = await read("SECURITY.md");
const defectPolicy = await read("docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md");
const pullRequestTemplate = await read(".github/PULL_REQUEST_TEMPLATE.md");

assert(
  bugForm.name === "Bug report",
  "Bug issue form must have a stable name.",
);
assert(Array.isArray(bugForm.body), "Bug issue form body must be an array.");

const fields = new Map(
  bugForm.body
    .filter((item) => typeof item?.id === "string")
    .map((item) => [item.id, item]),
);

const requiredFieldIds = [
  "affected_version",
  "expected_behavior",
  "actual_behavior",
  "reproduction_steps",
  "minimum_reproduction",
  "reproducibility_rate",
  "environment",
  "data_setup",
  "impact",
  "workaround",
  "regression_status",
  "version_range",
];

for (const id of requiredFieldIds) {
  assert(fields.has(id), `Bug issue form is missing required field: ${id}`);
  assert(
    fields.get(id)?.validations?.required === true,
    `Bug issue form field must be required: ${id}`,
  );
}

const safetyOptions = fields.get("safety_confirmation")?.attributes?.options;
assert(
  fields.has("safety_confirmation") &&
    Array.isArray(safetyOptions) &&
    safetyOptions.length >= 3 &&
    safetyOptions.every((option) => option.required === true),
  "Safety confirmations must be individually required.",
);

const renderedBugForm = JSON.stringify(bugForm);
assert(
  /private reporting path|private route/i.test(renderedBugForm),
  "Bug form must route suspected vulnerabilities privately.",
);
assert(
  renderedBugForm.includes(
    "https://github.com/cryptnetworks/baseballstattrack/blob/main/SECURITY.md",
  ),
  "Bug form must use a stable link to SECURITY.md.",
);
assert(
  /synthetic|redacted/i.test(renderedBugForm),
  "Bug form must require safe reproduction data.",
);
assert(
  issueConfig.blank_issues_enabled === false,
  "Blank issues must remain disabled so safety guidance is not bypassed.",
);

const contactLinks = issueConfig.contact_links;
assert(
  Array.isArray(contactLinks) &&
    contactLinks.some(
      (link) =>
        link.url === "https://mdesocio.com/#hero" &&
        /do not open an issue/i.test(link.about),
    ),
  "Issue configuration must expose the verified private-contact fallback.",
);
assert(
  !JSON.stringify(issueConfig).includes("/security/advisories/new"),
  "Issue configuration must not claim the unavailable advisory form works.",
);

assert(
  /Do not open an issue or pull request/i.test(securityPolicy),
  "SECURITY.md must prohibit vulnerability details in issues and PRs.",
);
assert(
  /No fixed response or remediation time is promised/i.test(securityPolicy),
  "SECURITY.md must not make an unsupported response-time promise.",
);
assert(
  /durable automated regression test/i.test(defectPolicy) &&
    /manual verification procedure/i.test(defectPolicy) &&
    /named owner/i.test(defectPolicy),
  "Defect policy must enforce regression evidence or the complete exception.",
);
assert(
  /A merge alone is not verification/i.test(defectPolicy),
  "Defect policy must require post-merge verification.",
);

for (const requiredPolicyTerm of [
  "S0 — critical",
  "S1 — high",
  "S2 — moderate",
  "S3 — low",
  "P0 — immediate",
  "P1 — next planned work",
  "P2 — normal backlog",
  "P3 — deferred",
  "Ordinary UI bug",
  "Replay divergence",
  "Cross-Account data exposure",
  "Production secret exposure",
  "Incorrect statistic",
  "Migration regression",
  "Intermittent duplicate submission",
  "Accessibility defect",
  "Documentation defect",
]) {
  assert(
    defectPolicy.includes(requiredPolicyTerm),
    `Defect policy is missing required coverage: ${requiredPolicyTerm}`,
  );
}

assert(
  /Linked defect and original reproduction/i.test(pullRequestTemplate) &&
    /Root cause/i.test(pullRequestTemplate) &&
    /Regression test/i.test(pullRequestTemplate),
  "Pull request template must capture defect-fix evidence.",
);
assert(
  /Refs #/.test(pullRequestTemplate) && !/^Closes #/m.test(pullRequestTemplate),
  "Pull request template must not automatically close unverified defects.",
);

const placeholderPatterns = [
  /security@example\.(?:com|org|net)/i,
  /security@your-domain/i,
  /<security-email>/i,
];

for (const content of [securityPolicy, defectPolicy, renderedBugForm]) {
  for (const pattern of placeholderPatterns) {
    assert(
      !pattern.test(content),
      `Placeholder security contact found: ${pattern}`,
    );
  }
}

const markdownFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github/label-taxonomy.md",
  "docs/DEFECT_TRIAGE_AND_REGRESSION_POLICY.md",
];
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

for (const relativePath of markdownFiles) {
  const content = await read(relativePath);

  for (const match of content.matchAll(markdownLinkPattern)) {
    const target = match[1].trim();
    if (
      target.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.includes(" ")
    ) {
      continue;
    }

    const fileTarget = target.split("#", 1)[0];
    if (fileTarget.length === 0) {
      continue;
    }

    await access(path.resolve(root, path.dirname(relativePath), fileTarget));
  }
}

console.log("Defect policy, templates, YAML, and internal links are valid.");
