import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ComposeDeployment,
  deploymentPaths,
  REQUIRED_MIGRATION,
} from "../../scripts/deploy/compose.ts";
import {
  createDeploymentConfiguration,
  parseEnvironment,
  redactSensitive,
  serializeEnvironment,
} from "../../scripts/deploy/config.ts";
import type {
  CommandRunner,
  GeneratedSecrets,
  InstallerAnswers,
} from "../../scripts/deploy/contracts.ts";
import { inspectDockerRequirements } from "../../scripts/deploy/docker.ts";
import { validateDeploymentHealth } from "../../scripts/deploy/health.ts";
import { detectHostPlatform } from "../../scripts/deploy/platform.ts";
import {
  chooseDatabaseSafetyAction,
  chooseUninstallAction,
  parseModeChoice,
  type WizardIO,
} from "../../scripts/deploy/wizard.ts";

const answers: InstallerAnswers = {
  mode: "production",
  siteUrl: "https://stats.example.test",
  timezone: "America/New_York",
  appPort: 3000,
  bindAddress: "127.0.0.1",
  databaseName: "baseballstattrack",
  databaseUser: "baseballstattrack",
  accountDisplayName: "Spring League",
  accountSlug: "spring-league",
  provider: {
    provider: "google",
    clientId: "google-client",
    clientSecret: "a-secure-google-client-secret",
  },
  generateSecrets: true,
  imageTag: "sha-1234567890abcdef",
  buildLocalImages: false,
};

const secrets: GeneratedSecrets = {
  databasePassword: "database-password-long-enough",
  authenticationEncryptionKey: "authentication-encryption-key",
  webhookSigningMasterKey: "webhook-signing-master-key",
  webhookWorkerToken: "webhook-worker-token",
  externalIngestionWorkerToken: "external-worker-token",
  calendarFeedSigningKey: "calendar-signing-key",
  notificationWorkerToken: "notification-worker-token",
  notificationEventToken: "notification-event-token",
  discordUpdateEventToken: "discord-event-token",
  discordUpdateWorkerToken: "discord-worker-token",
};

function wizardWithAnswers(...values: string[]): WizardIO {
  return {
    ask: async () => values.shift() ?? "",
    write: () => undefined,
  };
}

describe("Docker deployment installer", () => {
  it("detects each supported host and WSL2", () => {
    expect(
      detectHostPlatform({ platform: "darwin", architecture: "arm64" }).host,
    ).toBe("macos");
    expect(detectHostPlatform({ platform: "win32" }).host).toBe("windows");
    expect(
      detectHostPlatform({ platform: "linux", osRelease: "ID=nixos\n" }).host,
    ).toBe("nixos");
    expect(detectHostPlatform({ platform: "linux" }).host).toBe("linux");
    expect(
      detectHostPlatform({
        platform: "linux",
        release: "6.6-microsoft-standard-WSL2",
      }),
    ).toMatchObject({ host: "windows", wsl2: true });
  });

  it("generates only infrastructure and bootstrap configuration", () => {
    const configuration = createDeploymentConfiguration(answers, secrets);
    expect(configuration.composeEnvironment).toMatchObject({
      APP_BIND_ADDRESS: "127.0.0.1",
      POSTGRES_DB: "baseballstattrack",
      IMAGE_PULL_POLICY: "always",
    });
    expect(configuration.applicationEnvironment).toMatchObject({
      AUTHENTICATION_ENABLED_PROVIDERS: "google",
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
    });
    expect(Object.keys(configuration.applicationEnvironment)).not.toContain(
      "FEATURE_FLAGS",
    );
    expect(Object.keys(configuration.applicationEnvironment)).not.toContain(
      "NOTIFICATION_SETTINGS",
    );
    expect(Object.keys(configuration.applicationEnvironment)).not.toContain(
      "INTEGRATIONS",
    );
    expect(
      parseEnvironment(
        serializeEnvironment(configuration.applicationEnvironment),
      ),
    ).toEqual(configuration.applicationEnvironment);
    expect(
      parseEnvironment(
        serializeEnvironment({ OAUTH_SECRET: "literal-$-and-'quote" }),
      ),
    ).toEqual({ OAUTH_SECRET: "literal-$-and-'quote" });
  });

  it("rejects unsafe configuration and masks secrets", () => {
    expect(() =>
      createDeploymentConfiguration({
        ...answers,
        siteUrl: "http://stats.example.test",
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      createDeploymentConfiguration({
        ...answers,
        accountSlug: "Spring League",
      }),
    ).toThrow(/slug/u);
    expect(
      redactSensitive(
        "postgresql://user:database-password-long-enough@db/data database-password-long-enough",
        [secrets.databasePassword],
      ),
    ).toBe("postgresql://user:[REDACTED]@db/data [REDACTED]");
  });

  it("reports Docker, daemon, Compose, disk, and port checks", async () => {
    const runner: CommandRunner = async (_command, commandArguments) => ({
      status: 0,
      stdout:
        commandArguments[0] === "--version"
          ? "Docker version 28"
          : commandArguments[0] === "info"
            ? "28.0"
            : commandArguments[1] === "version"
              ? "2.35"
              : "",
      stderr: "",
    });
    const checks = await inspectDockerRequirements({
      deploymentDirectory: process.cwd(),
      appPort: 3000,
      platform: "linux",
      runner,
    });
    expect(checks.map((check) => check.name)).toEqual([
      "Docker",
      "Docker daemon",
      "Compose",
      "Disk space",
      "Ports",
    ]);
    expect(
      checks
        .filter((check) => check.name !== "Disk space")
        .every((check) => check.ok),
    ).toBe(true);
  });

  it("explains a missing Docker CLI", async () => {
    const runner: CommandRunner = async () => {
      throw new Error("ENOENT");
    };
    const checks = await inspectDockerRequirements({
      deploymentDirectory: process.cwd(),
      appPort: 3000,
      platform: "macos",
      runner,
    });
    expect(checks.find((check) => check.name === "Docker")).toMatchObject({
      ok: false,
      detail: "Docker CLI is unavailable.",
    });
  });

  it("detects existing Compose state and uses a one-shot migration boundary", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, commandArguments) => {
      calls.push([...commandArguments]);
      return {
        status: commandArguments[0] === "volume" ? 0 : 0,
        stdout: commandArguments[0] === "ps" ? "container-id\n" : "",
        stderr: "",
      };
    };
    const compose = new ComposeDeployment(deploymentPaths("/tmp/deployment"), {
      runner,
    });
    await expect(compose.existingDeployment()).resolves.toEqual({
      containers: true,
      databaseVolume: true,
    });
    await compose.validate();
    await compose.runMigrations();
    expect(
      calls.some((call) => call.includes("config") && call.includes("--quiet")),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.includes("--abort-on-container-exit") &&
          call.includes("--exit-code-from") &&
          call.at(-1) === "migrate",
      ),
    ).toBe(true);
  });

  it("combines HTTP, database, migration, and service health", async () => {
    const compose = {
      databaseReady: async () => true,
      migrationStatus: async () => true,
      serviceStatus: async () => [{ State: "running", Health: "healthy" }],
    };
    const fetcher = async () => new Response("{}", { status: 200 });
    await expect(
      validateDeploymentHealth({
        compose,
        appPort: 3000,
        databaseUser: "baseballstattrack",
        databaseName: "baseballstattrack",
        fetcher,
      }),
    ).resolves.toMatchObject({ ok: true, services: true });
  });

  it("checks the Docker host gateway when the installer runs in a container", async () => {
    const requested: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response("{}", { status: 200 });
    };
    await validateDeploymentHealth({
      compose: {
        databaseReady: async () => true,
        migrationStatus: async () => true,
        serviceStatus: async () => [{ State: "running" }],
      },
      appPort: 33123,
      databaseUser: "baseballstattrack",
      databaseName: "baseballstattrack",
      healthHost: "host.docker.internal",
      fetcher,
    });
    expect(requested).toEqual([
      "http://host.docker.internal:33123/api/health",
      "http://host.docker.internal:33123/api/ready",
    ]);
  });

  it("pins health validation to the latest repository migration", () => {
    const latest = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    expect(REQUIRED_MIGRATION).toBe(latest);
  });

  it("requires explicit safety choices for existing data and uninstall", async () => {
    expect(parseModeChoice("4")).toBe("recovery");
    await expect(
      chooseDatabaseSafetyAction(wizardWithAnswers("2")),
    ).resolves.toBe("backup");
    await expect(chooseUninstallAction(wizardWithAnswers("4"))).resolves.toBe(
      "4",
    );
    await expect(
      chooseDatabaseSafetyAction(wizardWithAnswers("9")),
    ).rejects.toThrow(/Choose/u);
  });
});
