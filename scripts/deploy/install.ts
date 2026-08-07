#!/usr/bin/env node

import { access, copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  ComposeCommandError,
  ComposeDeployment,
  deploymentPaths,
  installComposeAsset,
} from "./compose.ts";
import {
  createDeploymentConfiguration,
  installationMetadata,
  parseEnvironment,
  redactSensitive,
  serializeEnvironment,
  writeProtectedFile,
} from "./config.ts";
import {
  dockerInstallationGuidance,
  inspectDockerRequirements,
} from "./docker.ts";
import { validateDeploymentHealth } from "./health.ts";
import { detectHostPlatform } from "./platform.ts";
import {
  chooseDatabaseSafetyAction,
  chooseUninstallAction,
  collectInstallerAnswers,
  confirm,
  terminalWizardIO,
} from "./wizard.ts";

const deploymentDirectory = process.env.BST_DEPLOYMENT_DIR ?? "/deployment";
const assetDirectory =
  process.env.BST_INSTALLER_ASSET_DIR ?? join(import.meta.dirname, "assets");
const sourceDirectory = process.env.BST_SOURCE_DIR ?? "/source";
const releaseSha = process.env.BST_RELEASE_SHA;
const io = terminalWizardIO();
const paths = deploymentPaths(deploymentDirectory);

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function progress(message: string) {
  io.write(`\n${message}...`);
  return () => io.write("✓");
}

function help() {
  io.write(`Baseball Stat Track Docker deployment wizard

Usage: install.ts [install|update|recover|status|logs|uninstall|preflight]

The supported target-host dependency is Docker Desktop or Docker Engine with
Compose v2. The installer never installs PostgreSQL, Node.js, Python, or
application dependencies on the host.`);
}

async function configurationFromDisk() {
  const composeEnvironment = parseEnvironment(
    await readFile(paths.environmentFile, "utf8"),
  );
  const applicationEnvironment = parseEnvironment(
    await readFile(paths.applicationEnvironmentFile, "utf8"),
  );
  const secrets = [
    composeEnvironment.POSTGRES_PASSWORD,
    ...Object.entries(applicationEnvironment)
      .filter(([key]) =>
        /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SIGNING_KEY|ENCRYPTION_KEY/u.test(
          key,
        ),
      )
      .map(([, value]) => value),
  ].filter((value): value is string => Boolean(value));
  return { composeEnvironment, applicationEnvironment, secrets };
}

async function preflight(appPort = 3000, checkPort = true) {
  const platform = detectHostPlatform();
  io.write(
    `Detected ${platform.host} (${platform.architecture})${platform.wsl2 ? " with WSL2" : ""}.`,
  );
  const checks = await inspectDockerRequirements({
    deploymentDirectory,
    appPort,
    platform: platform.host,
    checkPort,
  });
  for (const check of checks) {
    io.write(`${check.name}: ${check.ok ? "✓" : "✗"} ${check.detail}`);
  }
  if (checks.some((check) => !check.ok)) {
    throw new Error(
      `Docker requirements are incomplete. ${dockerInstallationGuidance(platform.host)}`,
    );
  }
}

async function validateInstallPort(appPort: number) {
  const platform = detectHostPlatform();
  const checks = await inspectDockerRequirements({
    deploymentDirectory,
    appPort,
    platform: platform.host,
  });
  const port = checks.find((check) => check.name === "Ports");
  if (!port) throw new Error("The application port could not be validated.");
  io.write(`${port.name}: ${port.ok ? "✓" : "✗"} ${port.detail}`);
  if (!port.ok) throw new Error(port.detail);
}

async function install() {
  const sourceAvailable = await exists(join(sourceDirectory, "Dockerfile"));
  const answers = await collectInstallerAnswers({
    io,
    deploymentDirectory,
    ...(releaseSha ? { releaseSha } : {}),
    sourceAvailable,
  });
  await preflight(answers.appPort, false);
  const configuration = createDeploymentConfiguration(answers);
  const compose = new ComposeDeployment(paths, {
    secrets: Object.values(configuration.secrets),
  });
  const existing = await compose.existingDeployment();
  if (
    existing.containers ||
    existing.databaseVolume ||
    (await exists(paths.environmentFile)) ||
    (await exists(paths.applicationEnvironmentFile))
  ) {
    const action = await chooseDatabaseSafetyAction(io);
    if (action === "cancel")
      throw new Error("Installation cancelled; existing data was not changed.");
    if (!(await exists(paths.environmentFile))) {
      throw new Error(
        "Existing Docker state has no matching protected configuration. Use recovery mode; the installer will not overwrite it.",
      );
    }
    if (action === "backup") {
      const prior = await configurationFromDisk();
      const existingCompose = new ComposeDeployment(paths, {
        secrets: prior.secrets,
      });
      await existingCompose.startDatabase();
      const backupPath = join(
        deploymentDirectory,
        "backups",
        `preinstall-${Date.now()}.dump`,
      );
      await existingCompose.backup(
        prior.composeEnvironment.POSTGRES_USER!,
        prior.composeEnvironment.POSTGRES_DB!,
        backupPath,
      );
      io.write(`Backup created at ${backupPath} (contents not displayed).`);
    }
    await recover();
    return;
  }
  await validateInstallPort(answers.appPort);

  const completeConfiguration = progress("Creating protected configuration");
  await installComposeAsset(
    join(assetDirectory, "docker-compose.yml"),
    paths.composeFile,
  );
  await writeProtectedFile(
    paths.environmentFile,
    serializeEnvironment(configuration.composeEnvironment),
  );
  await writeProtectedFile(
    paths.applicationEnvironmentFile,
    serializeEnvironment(configuration.applicationEnvironment),
  );
  await writeProtectedFile(
    paths.metadataFile,
    `${JSON.stringify(installationMetadata(answers), null, 2)}\n`,
  );
  completeConfiguration();

  const completeValidation = progress(
    "Validating Docker Compose configuration",
  );
  await compose.validate();
  completeValidation();
  if (answers.buildLocalImages) {
    const completeBuild = progress("Building local application images");
    await compose.buildLocalImages(sourceDirectory, answers.imageTag);
    completeBuild();
  } else {
    const completePull = progress("Pulling immutable application images");
    await compose.pull();
    completePull();
  }
  const completeDatabase = progress("Starting PostgreSQL");
  await compose.startDatabase();
  completeDatabase();
  const completeMigrations = progress("Running database migrations");
  await compose.runMigrations();
  completeMigrations();
  const completeApplication = progress("Starting the application");
  await compose.startApplication();
  await compose.startEnabledServices();
  completeApplication();
  const completeHealth = progress(
    "Checking application, database, migrations, and services",
  );
  const health = await validateDeploymentHealth({
    compose,
    appPort: answers.appPort,
    databaseUser: answers.databaseUser,
    databaseName: answers.databaseName,
  });
  if (!health.ok) {
    throw new ComposeCommandError(
      `Health validation failed: ${JSON.stringify(health)}`,
      "Run the installer logs command. Configuration and the database volume were retained.",
    );
  }
  completeHealth();
  io.write(`\nInstallation complete. Open ${answers.siteUrl}`);
  io.write(
    answers.provider.provider === "local"
      ? "Next: open the site and sign in with the local username/password you just configured. The first successful sign-in creates the initial Account and owner membership."
      : "Next: sign in with the configured provider, provision the exact provider subject as the initial Account owner through the reviewed authorization procedure, then create revision 1 in Settings → Application configuration.",
  );
  io.write(
    "The installer never grants ownership by email and does not configure feature flags, notifications, or integrations.",
  );
}

async function recover() {
  const configuration = await configurationFromDisk();
  await preflight(Number(configuration.composeEnvironment.APP_PORT), false);
  const metadata = JSON.parse(
    await readFile(paths.metadataFile, "utf8"),
  ) as Record<string, unknown>;
  const compose = new ComposeDeployment(paths, {
    secrets: configuration.secrets,
  });
  const existing = await compose.existingDeployment();
  if (!existing.databaseVolume) {
    io.write(
      "No database volume exists yet; resuming the failed installation from protected configuration.",
    );
  }
  await compose.validate();
  if (configuration.composeEnvironment.IMAGE_PULL_POLICY === "never") {
    if (!(await exists(join(sourceDirectory, "Dockerfile")))) {
      throw new Error(
        "This local deployment requires the original source checkout mounted at /source.",
      );
    }
    await compose.buildLocalImages(
      sourceDirectory,
      String(metadata.imageTag ?? "local"),
    );
  } else {
    await compose.pull();
  }
  await compose.startDatabase();
  await compose.runMigrations();
  await compose.startApplication();
  await compose.startEnabledServices();
  const health = await validateDeploymentHealth({
    compose,
    appPort: Number(configuration.composeEnvironment.APP_PORT),
    databaseUser: configuration.composeEnvironment.POSTGRES_USER!,
    databaseName: configuration.composeEnvironment.POSTGRES_DB!,
  });
  if (!health.ok)
    throw new Error(
      `Recovery health validation failed: ${JSON.stringify(health)}`,
    );
  io.write(
    "Recovery completed without replacing the database volume or protected configuration.",
  );
}

async function update() {
  const configuration = await configurationFromDisk();
  await preflight(Number(configuration.composeEnvironment.APP_PORT), false);
  const compose = new ComposeDeployment(paths, {
    secrets: configuration.secrets,
  });
  const tag = (await io.ask("New immutable image tag: ")).trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(tag) || tag === "latest") {
    throw new Error(
      "Updates require an immutable version or sha-<full source SHA> tag.",
    );
  }
  const backupPath = join(
    deploymentDirectory,
    "backups",
    `preupdate-${Date.now()}.dump`,
  );
  const completeBackup = progress("Creating a pre-update database backup");
  await compose.backup(
    configuration.composeEnvironment.POSTGRES_USER!,
    configuration.composeEnvironment.POSTGRES_DB!,
    backupPath,
  );
  completeBackup();
  await copyFile(paths.environmentFile, `${paths.environmentFile}.previous`);
  const next: Record<string, string> = {
    ...configuration.composeEnvironment,
    APP_IMAGE: `ghcr.io/cryptnetworks/baseballstattrack:${tag}`,
    MIGRATION_IMAGE: `ghcr.io/cryptnetworks/baseballstattrack-migration:${tag}`,
    DISCORD_BOT_IMAGE: `ghcr.io/cryptnetworks/baseballstattrack-discord-bot:${tag}`,
    IMAGE_PULL_POLICY: "always",
  };
  const metadata = JSON.parse(
    await readFile(paths.metadataFile, "utf8"),
  ) as Record<string, unknown>;
  await writeProtectedFile(paths.environmentFile, serializeEnvironment(next));
  await writeProtectedFile(
    paths.metadataFile,
    `${JSON.stringify({ ...metadata, imageTag: tag, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  await compose.validate();
  await compose.pull();
  await compose.startDatabase();
  await compose.runMigrations();
  await compose.startApplication();
  await compose.startEnabledServices();
  const health = await validateDeploymentHealth({
    compose,
    appPort: Number(next.APP_PORT),
    databaseUser: next.POSTGRES_USER!,
    databaseName: next.POSTGRES_DB!,
  });
  if (!health.ok) {
    throw new ComposeCommandError(
      `Update health validation failed: ${JSON.stringify(health)}`,
      `Keep ${backupPath} and ${paths.environmentFile}.previous. Applied migrations must not be reversed; follow the documented roll-forward or restore procedure.`,
    );
  }
  io.write(`Update complete. Backup retained at ${backupPath}.`);
}

async function status() {
  const configuration = await configurationFromDisk();
  const compose = new ComposeDeployment(paths, {
    secrets: configuration.secrets,
  });
  const health = await validateDeploymentHealth({
    compose,
    appPort: Number(configuration.composeEnvironment.APP_PORT),
    databaseUser: configuration.composeEnvironment.POSTGRES_USER!,
    databaseName: configuration.composeEnvironment.POSTGRES_DB!,
  });
  io.write(JSON.stringify(health, null, 2));
  if (!health.ok) process.exitCode = 1;
}

async function logs() {
  const configuration = await configurationFromDisk();
  const compose = new ComposeDeployment(paths, {
    secrets: configuration.secrets,
  });
  const result = await compose.logs();
  io.write(redactSensitive(result.stdout, configuration.secrets));
}

async function uninstall() {
  const configuration = await configurationFromDisk();
  const compose = new ComposeDeployment(paths, {
    secrets: configuration.secrets,
  });
  const choice = await chooseUninstallAction(io);
  if (choice === "4") return;
  const removesVolumes = choice === "2" || choice === "3";
  if (removesVolumes) {
    const phrase = await io.ask('Type "delete database volume" to confirm: ');
    if (phrase !== "delete database volume")
      throw new Error("Destructive removal cancelled.");
    if (!(await confirm(io, "A verified external backup exists"))) {
      throw new Error(
        "Volume removal requires a verified backup confirmation.",
      );
    }
  }
  await compose.down(removesVolumes);
  if (choice === "3") {
    for (const path of [
      paths.composeFile,
      paths.environmentFile,
      paths.applicationEnvironmentFile,
      paths.metadataFile,
      `${paths.environmentFile}.previous`,
    ]) {
      await rm(path, { force: true });
    }
    io.write(
      "Generated configuration was removed. Backup archives were retained.",
    );
  }
}

async function main() {
  const command = process.argv[2] ?? "install";
  if (command === "--help" || command === "help") return help();
  if (command === "preflight") return preflight();
  if (command === "install") return install();
  if (command === "update") return update();
  if (command === "recover") return recover();
  if (command === "status") return status();
  if (command === "logs") return logs();
  if (command === "uninstall") return uninstall();
  throw new Error(`Unknown installer command: ${command}`);
}

main().catch((error: unknown) => {
  if (error instanceof ComposeCommandError) {
    io.write(
      `\nInstallation stopped safely.\n${error.message}\nRecovery: ${error.recovery}`,
    );
  } else if (error instanceof Error) {
    io.write(`\nInstallation stopped safely.\n${error.message}`);
  } else {
    io.write("\nInstallation stopped safely for an unknown reason.");
  }
  process.exitCode = 1;
});
