import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Docker deployment launchers", () => {
  it("creates protected Compose bootstrap files without direct docker run", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "bst-launcher-"));
    try {
      const binaryDirectory = join(temporaryDirectory, "bin");
      const deploymentDirectory = join(
        temporaryDirectory,
        "deployment's files",
      );
      const dockerLog = join(temporaryDirectory, "docker.log");
      const fakeDocker = join(binaryDirectory, "docker");
      await mkdir(binaryDirectory);
      await writeFile(
        fakeDocker,
        '#!/bin/sh\nprintf "%s\\n" "$*" >>"$BST_DOCKER_LOG"\nexit 0\n',
        { mode: 0o700 },
      );
      await chmod(fakeDocker, 0o700);

      const result = spawnSync(
        "sh",
        [join(process.cwd(), "install.sh"), "preflight"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            BST_DEPLOYMENT_DIRECTORY: deploymentDirectory,
            BST_DOCKER_LOG: dockerLog,
            BST_INSTALLER_IMAGE: "registry.example.test/installer:sha-tested",
            BST_SOURCE_DIRECTORY: process.cwd(),
            PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
          },
        },
      );
      expect(result).toMatchObject({ status: 0, stderr: "" });

      const bootstrapCompose = join(
        deploymentDirectory,
        "compose.installer.yml",
      );
      const bootstrapEnvironment = join(deploymentDirectory, ".env.installer");
      const [
        compose,
        environment,
        commands,
        shellLauncher,
        powershellLauncher,
      ] = await Promise.all([
        readFile(bootstrapCompose, "utf8"),
        readFile(bootstrapEnvironment, "utf8"),
        readFile(dockerLog, "utf8"),
        readFile(join(process.cwd(), "install.sh"), "utf8"),
        readFile(join(process.cwd(), "install.ps1"), "utf8"),
      ]);

      expect(compose).toContain("services:\n  installer:");
      expect(compose).toContain(
        "pull_policy: ${BST_INSTALLER_PULL_POLICY:-always}",
      );
      expect(environment).toContain(
        "BST_INSTALLER_IMAGE='registry.example.test/installer:sha-tested'",
      );
      expect(environment).toContain("BST_INSTALLER_PULL_POLICY='always'");
      expect(environment).toContain("deployment\\'s files");
      expect(commands).toContain("config --quiet");
      expect(commands).toContain("--project-name baseballstattrack-installer-");
      expect(commands).toContain("run --rm --no-TTY installer preflight");
      expect(commands).toContain("down --remove-orphans");
      expect(shellLauncher).not.toMatch(/\bdocker\s+run\b/u);
      expect(powershellLauncher).not.toMatch(/\bdocker\s+run\b/u);
      expect((await stat(bootstrapCompose)).mode & 0o777).toBe(0o600);
      expect((await stat(bootstrapEnvironment)).mode & 0o777).toBe(0o600);

      const invalidPolicy = spawnSync(
        "sh",
        [join(process.cwd(), "install.sh"), "preflight"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            BST_INSTALLER_PULL_POLICY: "sometimes",
          },
        },
      );
      expect(invalidPolicy.status).toBe(1);
      expect(invalidPolicy.stderr).toContain(
        "BST_INSTALLER_PULL_POLICY must be always, missing, or never.",
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
