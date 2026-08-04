import { arch, platform, release } from "node:os";

import type { HostPlatform } from "./contracts.ts";

type DetectionInput = Readonly<{
  platform?: NodeJS.Platform;
  architecture?: string;
  release?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  osRelease?: string;
}>;

export type PlatformDetection = Readonly<{
  host: HostPlatform;
  architecture: string;
  wsl2: boolean;
  dockerDesktopExpected: boolean;
  guidance: string;
}>;

function explicitHost(value: string | undefined): HostPlatform | null {
  const normalized = value?.trim().toLowerCase();
  return normalized &&
    ["macos", "windows", "nixos", "linux"].includes(normalized)
    ? (normalized as HostPlatform)
    : null;
}

export function detectHostPlatform(
  input: DetectionInput = {},
): PlatformDetection {
  const environment = input.environment ?? process.env;
  const runtimePlatform = input.platform ?? platform();
  const runtimeRelease = input.release ?? release();
  const architecture = input.architecture ?? arch();
  const wsl2 =
    Boolean(environment.WSL_INTEROP) ||
    /microsoft|wsl2?/iu.test(runtimeRelease);
  const selected = explicitHost(environment.BST_HOST_PLATFORM);
  const nixos = /(?:^|\n)ID\s*=\s*"?nixos"?(?:\n|$)/iu.test(
    input.osRelease ?? environment.BST_HOST_OS_RELEASE ?? "",
  );
  const host =
    selected ??
    (runtimePlatform === "darwin"
      ? "macos"
      : runtimePlatform === "win32" || wsl2
        ? "windows"
        : nixos
          ? "nixos"
          : "linux");

  const guidance: Record<HostPlatform, string> = {
    macos:
      "Install Docker Desktop for Mac, open it, and wait for the engine status to report Running.",
    windows:
      "Install Docker Desktop with WSL2 integration, then run the PowerShell launcher from a directory shared with Docker Desktop.",
    nixos:
      "Enable a Docker daemon and the Docker Compose plugin in the host configuration; the installer does not change NixOS modules.",
    linux:
      "Install Docker Engine with the Compose plugin and grant the current operator access to the Docker daemon.",
  };

  return Object.freeze({
    host,
    architecture,
    wsl2,
    dockerDesktopExpected: host === "macos" || host === "windows",
    guidance: guidance[host],
  });
}
