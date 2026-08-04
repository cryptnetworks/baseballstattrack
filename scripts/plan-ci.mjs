import { fileURLToPath } from "node:url";

const fullValidationPaths = new Set([
  ".github/workflows/ci.yml",
  "scripts/plan-ci.mjs",
  "tests/quality/ci-scope.test.ts",
]);

const nodeDependencyPaths = new Set(["package.json", "package-lock.json"]);

const repositoryPolicyPaths = new Set([
  "scripts/verify-docs-wiki-workflow.mjs",
  "scripts/verify-security-workflows.mjs",
]);

const applicationConfigurationPaths = new Set([
  ".env.example",
  ".env.local.example",
  ".env.production.example",
  ".prettierignore",
  ".prettierrc.json",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "prisma.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
]);

const containerPaths = new Set([
  ".dockerignore",
  "Dockerfile",
  ".env.production.example",
  "compose.production.env.example",
  "docker-compose.yml",
]);

const operationalScripts = new Set([
  "scripts/backup-database.sh",
  "scripts/fixtures/backup-restore.sql",
  "scripts/release-rehearsal.sh",
  "scripts/restore-database.sh",
  "scripts/verify-backup-restore.sh",
  "scripts/verify-reliability-drill.sh",
]);

const containerScripts = new Set([
  "scripts/build-production-images.sh",
  "scripts/container-smoke.sh",
  "scripts/release-rehearsal.sh",
]);

const createPlan = () => ({
  application: false,
  api: false,
  containers: false,
  database: false,
  discord: false,
  documentation: false,
  operations: false,
});

const enableFullValidation = (plan) => {
  for (const scope of Object.keys(plan)) {
    plan[scope] = true;
  }
};

const isDocumentationPath = (file) =>
  file === "CODE_OF_CONDUCT.md" ||
  file === "CONTRIBUTING.md" ||
  file === "README.md" ||
  file === "SECURITY.md" ||
  file.startsWith(".agents/") ||
  file.startsWith(".github/ISSUE_TEMPLATE/") ||
  (file.startsWith(".github/") && !file.startsWith(".github/workflows/")) ||
  file.startsWith("docs/") ||
  file.endsWith(".md") ||
  file.endsWith(".mdx");

const isDatabasePath = (file) =>
  file.startsWith("prisma/") ||
  file.startsWith("src/server/data/") ||
  file.startsWith("tests/persistence/") ||
  file === "scripts/verify-migration.mjs" ||
  file === "scripts/verify-relational-representability.mjs";

export function planCiScopes(files, { forceFull = false } = {}) {
  const plan = createPlan();
  const normalizedFiles = [...new Set(files.filter(Boolean))];

  if (forceFull || normalizedFiles.length === 0) {
    enableFullValidation(plan);
    return plan;
  }

  for (const file of normalizedFiles) {
    if (fullValidationPaths.has(file)) {
      enableFullValidation(plan);
      continue;
    }

    if (file.startsWith(".github/workflows/")) {
      plan.documentation = true;
      if (
        file === ".github/workflows/publish-containers.yml" ||
        file === ".github/workflows/release.yml"
      ) {
        plan.containers = true;
      }
      continue;
    }

    if (nodeDependencyPaths.has(file)) {
      plan.application = true;
      plan.containers = true;
      continue;
    }

    if (repositoryPolicyPaths.has(file)) {
      plan.documentation = true;
      continue;
    }

    if (file.startsWith("docs/api/")) {
      plan.api = true;
      plan.application = true;
      plan.documentation = true;
      continue;
    }

    if (isDocumentationPath(file)) {
      plan.documentation = true;
      continue;
    }

    if (file.startsWith("services/discord-bot/")) {
      plan.discord = true;
      continue;
    }

    if (containerPaths.has(file) || file.startsWith("container/")) {
      plan.containers = true;
      if (applicationConfigurationPaths.has(file)) {
        plan.application = true;
      }
      continue;
    }

    if (containerScripts.has(file)) {
      plan.containers = true;
    }

    if (operationalScripts.has(file)) {
      plan.operations = true;
      plan.database = true;
    }

    if (isDatabasePath(file)) {
      plan.database = true;
      plan.application = true;
    }

    if (
      file.startsWith("src/app/api/v1/") ||
      file === "scripts/verify-statistics-api-contract.mjs"
    ) {
      plan.api = true;
    }

    if (
      applicationConfigurationPaths.has(file) ||
      file.startsWith("public/") ||
      file.startsWith("scripts/") ||
      file.startsWith("src/") ||
      file.startsWith("tests/")
    ) {
      plan.application = true;
      continue;
    }

    // Unknown paths fail safe by receiving the complete application gate.
    plan.application = true;
  }

  if (plan.api || plan.database || plan.operations) {
    plan.application = true;
  }

  if (
    plan.database &&
    normalizedFiles.some((file) => file.startsWith("prisma/"))
  ) {
    plan.containers = true;
    plan.operations = true;
  }

  return plan;
}

async function main() {
  const forceFull = process.argv.includes("--full");
  let input = "";
  if (!forceFull) {
    for await (const chunk of process.stdin) {
      input += chunk;
    }
  }
  const delimiter = input.includes("\0") ? "\0" : "\n";
  const files = input.split(delimiter).filter(Boolean);
  const plan = planCiScopes(files, { forceFull });

  for (const [scope, enabled] of Object.entries(plan)) {
    process.stdout.write(`${scope}=${enabled}\n`);
  }

  process.stderr.write(
    `CI scope: ${Object.entries(plan)
      .filter(([, enabled]) => enabled)
      .map(([scope]) => scope)
      .join(", ")}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
