import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import type {
  AuthenticationProvider,
  DeploymentMode,
  InstallerAnswers,
  ProviderBootstrap,
} from "./contracts.ts";

export type WizardIO = Readonly<{
  ask: (
    question: string,
    options?: Readonly<{ secret?: boolean }>,
  ) => Promise<string>;
  write: (message: string) => void;
}>;

async function hiddenQuestion(question: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Secret entry requires an interactive terminal.");
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

export function terminalWizardIO(): WizardIO {
  return Object.freeze({
    ask: async (question, options) => {
      if (options?.secret) return hiddenQuestion(question);
      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return await readline.question(question);
      } finally {
        readline.close();
      }
    },
    write: (message) => process.stdout.write(`${message}\n`),
  });
}

export function parseModeChoice(value: string): DeploymentMode {
  const choices: Record<string, DeploymentMode> = {
    "1": "local",
    "2": "team",
    "3": "production",
    "4": "recovery",
  };
  const mode = choices[value.trim()];
  if (!mode) throw new Error("Choose 1, 2, 3, or 4.");
  return mode;
}

const providerChoices: Record<string, AuthenticationProvider> = {
  "1": "local",
  "2": "authentik",
  "3": "google",
  "4": "discord",
  "5": "facebook",
  "6": "apple",
};

function defaultSlug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || "baseball"
  );
}

export async function confirm(io: WizardIO, question: string) {
  return /^(?:y|yes)$/iu.test((await io.ask(`${question} [y/N]: `)).trim());
}

async function providerBootstrap(
  io: WizardIO,
  deploymentDirectory: string,
  mode: DeploymentMode,
): Promise<ProviderBootstrap> {
  io.write("\nChoose the initial administrator sign-in provider:");
  io.write(
    "1. Local username/password (local development)\n2. Authentik\n3. Google\n4. Discord\n5. Facebook\n6. Apple",
  );
  const provider = providerChoices[(await io.ask("Choice: ")).trim()];
  if (!provider) throw new Error("Choose a supported authentication provider.");
  if (provider === "local") {
    if (mode !== "local")
      throw new Error(
        "Local authentication is only available for local development.",
      );
    const username =
      (await io.ask("Local username [admin]: ")).trim() || "admin";
    const password = await io.ask(
      "Local password (hidden, min 16 characters): ",
      { secret: true },
    );
    return { provider, clientId: "local", username, password };
  }
  const clientId = (await io.ask("OAuth client ID: ")).trim();
  if (provider === "apple") {
    const teamId = (await io.ask("Apple team ID: ")).trim();
    const keyId = (await io.ask("Apple key ID: ")).trim();
    const privateKeyPath = (
      await io.ask(
        "Apple private-key filename in the protected deployment directory: ",
      )
    ).trim();
    const privateKey = await readFile(
      join(deploymentDirectory, privateKeyPath),
      "utf8",
    );
    return { provider, clientId, teamId, keyId, privateKey };
  }
  const clientSecret = await io.ask("OAuth client secret (hidden): ", {
    secret: true,
  });
  if (provider === "authentik") {
    const issuerUrl = (await io.ask("Authentik issuer URL: ")).trim();
    return { provider, clientId, clientSecret, issuerUrl };
  }
  return { provider, clientId, clientSecret };
}

export async function collectInstallerAnswers(input: {
  io: WizardIO;
  deploymentDirectory: string;
  releaseSha?: string;
  sourceAvailable?: boolean;
}): Promise<InstallerAnswers> {
  const { io } = input;
  io.write("Welcome to Baseball Stat Track setup.\n");
  io.write("What are you installing?");
  io.write(
    "1. Local development\n2. Team/league server\n3. Production deployment\n4. Existing deployment recovery",
  );
  const mode = parseModeChoice(await io.ask("Choice: "));
  if (mode === "recovery") throw new Error("RECOVERY_SELECTED");
  const defaultUrl =
    mode === "local" ? "http://localhost:3000" : "https://stats.example.com";
  const siteUrl =
    (await io.ask(`Deployment URL [${defaultUrl}]: `)).trim() || defaultUrl;
  const timezone = (await io.ask("IANA timezone [UTC]: ")).trim() || "UTC";
  const port = (await io.ask("Host application port [3000]: ")).trim();
  const appPort = port ? Number(port) : 3000;
  const bindAddress = mode === "team" ? "0.0.0.0" : "127.0.0.1";
  const databaseName =
    (await io.ask("PostgreSQL database name [baseballstattrack]: ")).trim() ||
    "baseballstattrack";
  const databaseUser =
    (await io.ask("PostgreSQL user [baseballstattrack]: ")).trim() ||
    "baseballstattrack";
  const accountDisplayName = (
    await io.ask("Initial Account/league name: ")
  ).trim();
  const suggestedSlug = defaultSlug(accountDisplayName);
  const accountSlug =
    (await io.ask(`Account slug [${suggestedSlug}]: `)).trim() || suggestedSlug;
  const provider = await providerBootstrap(io, input.deploymentDirectory, mode);
  if (
    !(await confirm(
      io,
      "Generate new database, encryption, signing, and worker secrets?",
    ))
  ) {
    throw new Error("Secure secret generation approval is required.");
  }
  const buildLocalImages =
    Boolean(input.sourceAvailable) &&
    mode === "local" &&
    (await confirm(
      io,
      "Build application images from the mounted source checkout?",
    ));
  const releaseTag = /^[a-f0-9]{40}$/u.test(input.releaseSha ?? "")
    ? `sha-${input.releaseSha}`
    : "latest";
  const defaultTag = buildLocalImages ? "local" : releaseTag;
  const imageTag =
    (await io.ask(`Application image tag [${defaultTag}]: `)).trim() ||
    defaultTag;
  if (mode === "production" && imageTag === "latest") {
    throw new Error(
      "Production requires an immutable version or sha-<full source SHA> image tag.",
    );
  }
  return {
    mode,
    siteUrl,
    timezone,
    appPort,
    bindAddress,
    databaseName,
    databaseUser,
    accountDisplayName,
    accountSlug,
    provider,
    generateSecrets: true,
    imageTag,
    buildLocalImages,
  };
}

export async function chooseDatabaseSafetyAction(io: WizardIO) {
  io.write("\nExisting database detected.");
  io.write("1. Continue without replacing data\n2. Backup first\n3. Cancel");
  const choice = (await io.ask("Choice: ")).trim();
  if (!["1", "2", "3"].includes(choice)) throw new Error("Choose 1, 2, or 3.");
  return choice === "1" ? "continue" : choice === "2" ? "backup" : "cancel";
}

export async function chooseUninstallAction(io: WizardIO) {
  io.write("\nUninstall options:");
  io.write(
    "1. Remove containers only (database volume retained)\n2. Remove containers and volumes\n3. Full cleanup (backups retained)\n4. Cancel",
  );
  const choice = (await io.ask("Choice: ")).trim();
  if (!["1", "2", "3", "4"].includes(choice)) {
    throw new Error("Choose 1, 2, 3, or 4.");
  }
  return choice;
}
