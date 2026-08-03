import { fileURLToPath } from "node:url";

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
  const audit = planSecurityAuditScopes(files, { forceFull });

  process.stdout.write(`containers=${audit.containers}\n`);
  process.stdout.write(`node-dependencies=${audit.nodeDependencies}\n`);
  process.stdout.write(`python-dependencies=${audit.pythonDependencies}\n`);
  process.stderr.write(
    `Security audit scope: ${Object.entries(audit)
      .filter(([, enabled]) => enabled)
      .map(([scope]) => scope)
      .join(", ")}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
