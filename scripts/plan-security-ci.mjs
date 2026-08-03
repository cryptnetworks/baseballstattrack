import { fileURLToPath } from "node:url";

const languageOrder = ["actions", "javascript-typescript", "python"];

const javascriptExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const extension = (file) => {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "" : file.slice(dot);
};

export function planSecurityLanguages(files, { forceFull = false } = {}) {
  if (forceFull) return [...languageOrder];

  const languages = new Set();
  for (const file of new Set(files.filter(Boolean))) {
    if (
      file.startsWith(".github/workflows/") ||
      file.startsWith(".github/actions/")
    ) {
      languages.add("actions");
    }

    if (javascriptExtensions.has(extension(file))) {
      languages.add("javascript-typescript");
    }

    if (file.endsWith(".py")) {
      languages.add("python");
    }
  }

  return languageOrder.filter((language) => languages.has(language));
}

export function planSecurityAuditScopes(files, { forceFull = false } = {}) {
  if (forceFull) {
    return {
      containers: true,
      nodeDependencies: true,
      pythonDependencies: true,
    };
  }

  const normalizedFiles = new Set(files.filter(Boolean));
  const nodeDependencies =
    normalizedFiles.has("package.json") ||
    normalizedFiles.has("package-lock.json");
  const pythonDependencies = normalizedFiles.has(
    "services/discord-bot/requirements.lock",
  );
  const containers =
    nodeDependencies ||
    pythonDependencies ||
    normalizedFiles.has("Dockerfile") ||
    normalizedFiles.has("services/discord-bot/Dockerfile");

  return { containers, nodeDependencies, pythonDependencies };
}

async function main() {
  const forceFull = process.argv.includes("--full");
  let input = "";
  if (!forceFull) {
    for await (const chunk of process.stdin) input += chunk;
  }

  const delimiter = input.includes("\0") ? "\0" : "\n";
  const files = input.split(delimiter).filter(Boolean);
  const languages = planSecurityLanguages(files, { forceFull });
  const audit = planSecurityAuditScopes(files, { forceFull });

  process.stdout.write(`languages=${JSON.stringify(languages)}\n`);
  process.stdout.write(`containers=${audit.containers}\n`);
  process.stdout.write(`node-dependencies=${audit.nodeDependencies}\n`);
  process.stdout.write(`python-dependencies=${audit.pythonDependencies}\n`);
  process.stderr.write(
    `Security scope: ${[
      ...languages,
      ...Object.entries(audit)
        .filter(([, enabled]) => enabled)
        .map(([scope]) => scope),
    ].join(", ")}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
