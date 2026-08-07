import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { CommandResult, CommandRunner } from "./contracts.ts";
import { redactSensitive } from "./config.ts";
import { runCommand } from "./process.ts";

export const REQUIRED_MIGRATION = "20260806010000_configuration_entries";

type ComposePaths = Readonly<{
  directory: string;
  composeFile: string;
  environmentFile: string;
  applicationEnvironmentFile: string;
  metadataFile: string;
}>;

export function deploymentPaths(directory: string): ComposePaths {
  return Object.freeze({
    directory,
    composeFile: join(directory, "docker-compose.yml"),
    environmentFile: join(directory, ".env.production"),
    applicationEnvironmentFile: join(directory, "app.env"),
    metadataFile: join(directory, ".bst-installation.json"),
  });
}

export class ComposeCommandError extends Error {
  readonly recovery: string;

  constructor(message: string, recovery: string) {
    super(message);
    this.name = "ComposeCommandError";
    this.recovery = recovery;
  }
}

export class ComposeDeployment {
  private readonly runner: CommandRunner;
  private readonly secrets: readonly string[];
  readonly paths: ComposePaths;
  readonly projectName: string;

  constructor(
    paths: ComposePaths,
    options: Readonly<{
      runner?: CommandRunner;
      secrets?: readonly string[];
      projectName?: string;
    }> = {},
  ) {
    this.paths = paths;
    this.runner = options.runner ?? runCommand;
    this.secrets = options.secrets ?? [];
    this.projectName = options.projectName ?? "baseballstattrack";
  }

  private arguments(args: readonly string[]) {
    return [
      "compose",
      "--project-name",
      this.projectName,
      "--file",
      this.paths.composeFile,
      "--env-file",
      this.paths.environmentFile,
      ...args,
    ];
  }

  private async compose(args: readonly string[], recovery: string) {
    const result = await this.runner("docker", this.arguments(args), {
      cwd: this.paths.directory,
    });
    if (result.status !== 0) {
      const detail = redactSensitive(
        `${result.stdout}\n${result.stderr}`.trim(),
        this.secrets,
      );
      throw new ComposeCommandError(
        detail ? `Docker Compose failed: ${detail}` : "Docker Compose failed.",
        recovery,
      );
    }
    return result;
  }

  validate() {
    return this.compose(
      ["config", "--quiet"],
      "Review the generated environment files; no services were changed.",
    );
  }

  pull() {
    return this.compose(
      ["pull"],
      "Check registry access and image tags, then run the update again.",
    );
  }

  async buildLocalImages(sourceDirectory: string, imageTag: string) {
    const builds: ReadonlyArray<readonly string[]> = [
      [
        "build",
        "--target",
        "runtime",
        "--tag",
        `baseballstattrack:${imageTag}`,
        sourceDirectory,
      ],
      [
        "build",
        "--target",
        "migration",
        "--tag",
        `baseballstattrack-migration:${imageTag}`,
        sourceDirectory,
      ],
      [
        "build",
        "--tag",
        `baseballstattrack-discord-bot:${imageTag}`,
        join(sourceDirectory, "services", "discord-bot"),
      ],
    ];
    for (const args of builds) {
      const result = await this.runner("docker", args, {
        cwd: sourceDirectory,
      });
      if (result.status !== 0) {
        throw new ComposeCommandError(
          redactSensitive(result.stderr || result.stdout, this.secrets),
          "Fix the local image build and retry. Existing services were not replaced.",
        );
      }
    }
  }

  startDatabase() {
    return this.compose(
      ["up", "--detach", "--wait", "db"],
      "Inspect database logs with the installer logs command, then retry.",
    );
  }

  runMigrations() {
    return this.compose(
      [
        "up",
        "--no-deps",
        "--abort-on-container-exit",
        "--exit-code-from",
        "migrate",
        "migrate",
      ],
      "Do not edit applied migrations. Inspect migration logs and restore from backup if the documented recovery plan requires it.",
    );
  }

  startApplication() {
    return this.compose(
      ["up", "--detach", "--wait", "app"],
      "Inspect application and database logs; the database volume remains intact.",
    );
  }

  startEnabledServices() {
    return this.compose(
      ["up", "--detach", "--wait"],
      "Inspect the unhealthy worker or service. Core database data remains intact.",
    );
  }

  async existingDeployment() {
    const [containers, volume] = await Promise.all([
      this.runner("docker", [
        "ps",
        "--all",
        "--filter",
        `label=com.docker.compose.project=${this.projectName}`,
        "--format",
        "{{.ID}}",
      ]),
      this.runner("docker", [
        "volume",
        "inspect",
        `${this.projectName}_postgres-production-data`,
      ]),
    ]);
    return Object.freeze({
      containers: containers.status === 0 && Boolean(containers.stdout.trim()),
      databaseVolume: volume.status === 0,
    });
  }

  async serviceStatus() {
    const result = await this.compose(
      ["ps", "--all", "--format", "json"],
      "Run the installer logs command to inspect the deployment.",
    );
    const trimmed = result.stdout.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return trimmed.split(/\r?\n/u).map((line) => JSON.parse(line) as unknown);
    }
  }

  logs(): Promise<CommandResult> {
    return this.compose(
      ["logs", "--no-color", "--tail", "200"],
      "Run docker compose logs directly from the deployment directory.",
    );
  }

  down(removeVolumes = false) {
    return this.compose(
      ["down", ...(removeVolumes ? ["--volumes"] : [])],
      "Inspect Docker state before retrying removal. Never delete a volume manually without a verified backup.",
    );
  }

  async migrationStatus(databaseUser: string, databaseName: string) {
    const query = `SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1;`;
    const result = await this.compose(
      [
        "exec",
        "--no-TTY",
        "db",
        "psql",
        "--username",
        databaseUser,
        "--dbname",
        databaseName,
        "--tuples-only",
        "--no-align",
        "--command",
        query,
      ],
      "Confirm the migration service completed and inspect its logs.",
    );
    return result.stdout.trim() === REQUIRED_MIGRATION;
  }

  async databaseReady(databaseUser: string, databaseName: string) {
    const result = await this.compose(
      [
        "exec",
        "--no-TTY",
        "db",
        "pg_isready",
        "--username",
        databaseUser,
        "--dbname",
        databaseName,
      ],
      "Confirm the database container is running and inspect its health output.",
    );
    return result.stdout.includes("accepting connections");
  }

  async backup(
    databaseUser: string,
    databaseName: string,
    destination: string,
  ) {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const container = await this.compose(
      ["ps", "--quiet", "db"],
      "Start the database before requesting a backup.",
    );
    const containerId = container.stdout.trim();
    if (!containerId)
      throw new ComposeCommandError(
        "Database container is unavailable.",
        "Start the database and retry.",
      );
    const remote = `/tmp/${basename(destination)}.partial`;
    const dump = await this.runner("docker", [
      "exec",
      containerId,
      "pg_dump",
      "--username",
      databaseUser,
      "--dbname",
      databaseName,
      "--format",
      "custom",
      "--compress",
      "9",
      "--no-owner",
      "--no-acl",
      "--file",
      remote,
    ]);
    if (dump.status !== 0) {
      throw new ComposeCommandError(
        redactSensitive(dump.stderr, this.secrets),
        "The deployment was not changed. Resolve the backup failure before continuing.",
      );
    }
    try {
      const copied = await this.runner("docker", [
        "cp",
        `${containerId}:${remote}`,
        destination,
      ]);
      if (copied.status !== 0)
        throw new Error("Docker could not copy the backup archive.");
      const archive = await readFile(destination);
      const checksum = createHash("sha256").update(archive).digest("hex");
      await writeFile(
        `${destination}.sha256`,
        `${checksum}  ${basename(destination)}\n`,
        {
          mode: 0o600,
        },
      );
      await chmod(destination, 0o600).catch(() => undefined);
    } finally {
      await this.runner("docker", ["exec", containerId, "rm", "-f", remote]);
    }
  }
}

export async function installComposeAsset(asset: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(asset, destination);
  await chmod(destination, 0o600).catch(() => undefined);
}
