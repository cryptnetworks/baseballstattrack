import { z } from "zod";

export const installationSetupStatuses = [
  "NOT_STARTED",
  "BOOTSTRAP_IN_PROGRESS",
  "ADMIN_CREATED",
  "CONFIGURATION_REQUIRED",
  "READY",
] as const;

export const installationSetupStatusSchema = z.enum(installationSetupStatuses);
export type InstallationSetupLifecycleStatus = z.infer<
  typeof installationSetupStatusSchema
>;

const nextStatus: Readonly<
  Record<
    InstallationSetupLifecycleStatus,
    InstallationSetupLifecycleStatus | null
  >
> = Object.freeze({
  NOT_STARTED: "BOOTSTRAP_IN_PROGRESS",
  BOOTSTRAP_IN_PROGRESS: "ADMIN_CREATED",
  ADMIN_CREATED: "CONFIGURATION_REQUIRED",
  CONFIGURATION_REQUIRED: "READY",
  READY: null,
});

export function installationSetupTransitionAllowed(
  from: InstallationSetupLifecycleStatus,
  to: InstallationSetupLifecycleStatus,
) {
  return from === to || nextStatus[from] === to;
}

export function requireInstallationSetupTransition(
  from: InstallationSetupLifecycleStatus,
  to: InstallationSetupLifecycleStatus,
) {
  if (!installationSetupTransitionAllowed(from, to))
    throw new Error(`Invalid installation setup transition: ${from} -> ${to}`);
}
