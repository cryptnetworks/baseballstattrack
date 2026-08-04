import { statfs } from "node:fs/promises";

import type {
  CommandRunner,
  HostPlatform,
  RequirementCheck,
} from "./contracts.ts";
import { runCommand } from "./process.ts";

const minimumFreeBytes = 10 * 1024 * 1024 * 1024;

function gibibytes(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export async function inspectDockerRequirements(input: {
  deploymentDirectory: string;
  appPort: number;
  platform: HostPlatform;
  checkPort?: boolean;
  runner?: CommandRunner;
}): Promise<readonly RequirementCheck[]> {
  const runner = input.runner ?? runCommand;
  const checks: RequirementCheck[] = [];
  let dockerAvailable = false;
  try {
    const version = await runner("docker", ["--version"]);
    dockerAvailable = version.status === 0;
    checks.push({
      name: "Docker",
      ok: dockerAvailable,
      detail: dockerAvailable
        ? version.stdout.trim()
        : "Docker CLI is unavailable.",
    });
  } catch {
    checks.push({
      name: "Docker",
      ok: false,
      detail: "Docker CLI is unavailable.",
    });
  }

  if (dockerAvailable) {
    const [daemon, compose, ports] = await Promise.all([
      runner("docker", ["info", "--format", "{{.ServerVersion}}"]),
      runner("docker", ["compose", "version", "--short"]),
      runner("docker", ["ps", "--format", "{{.Ports}}"]),
    ]);
    checks.push({
      name: "Docker daemon",
      ok: daemon.status === 0,
      detail:
        daemon.status === 0
          ? `Engine ${daemon.stdout.trim()} is running.`
          : "The Docker daemon is not reachable by this operator.",
    });
    checks.push({
      name: "Compose",
      ok: compose.status === 0,
      detail:
        compose.status === 0
          ? `Compose ${compose.stdout.trim()} is available.`
          : "The Docker Compose v2 plugin is unavailable.",
    });
    if (input.checkPort !== false) {
      const expression = new RegExp(
        `(?:^|[,:])(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::\\])?:?${input.appPort}->`,
        "u",
      );
      const available = ports.status === 0 && !expression.test(ports.stdout);
      checks.push({
        name: "Ports",
        ok: available,
        detail: available
          ? `No running Docker container publishes port ${input.appPort}.`
          : `A running Docker container already publishes port ${input.appPort}.`,
      });
    }
  } else {
    checks.push({
      name: "Docker daemon",
      ok: false,
      detail: "Docker is required first.",
    });
    checks.push({
      name: "Compose",
      ok: false,
      detail: "Docker is required first.",
    });
    if (input.checkPort !== false) {
      checks.push({
        name: "Ports",
        ok: false,
        detail: "Port validation requires Docker.",
      });
    }
  }

  try {
    const filesystem = await statfs(input.deploymentDirectory);
    const available = Number(filesystem.bavail) * Number(filesystem.bsize);
    checks.push({
      name: "Disk space",
      ok: available >= minimumFreeBytes,
      detail: `${gibibytes(available)} free; at least ${gibibytes(minimumFreeBytes)} is required.`,
    });
  } catch {
    checks.push({
      name: "Disk space",
      ok: false,
      detail: "Free space could not be measured for the deployment directory.",
    });
  }

  const order = ["Docker", "Docker daemon", "Compose", "Disk space", "Ports"];
  return Object.freeze(
    checks.sort(
      (left, right) => order.indexOf(left.name) - order.indexOf(right.name),
    ),
  );
}

export function dockerInstallationGuidance(platform: HostPlatform) {
  const guidance: Record<HostPlatform, string> = {
    macos:
      "Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/ and start it.",
    windows:
      "Install Docker Desktop with WSL2 from https://docs.docker.com/desktop/setup/install/windows-install/ and enable WSL integration.",
    nixos:
      "Enable virtualisation.docker and the Compose plugin in your reviewed NixOS configuration, then restart the daemon.",
    linux:
      "Install Docker Engine and the Compose plugin using https://docs.docker.com/engine/install/ for your distribution.",
  };
  return guidance[platform];
}
