import { describe, expect, it } from "vitest";

import {
  installationSetupStatuses,
  installationSetupTransitionAllowed,
  requireInstallationSetupTransition,
} from "@/domain/installation-setup";

describe("installation setup lifecycle", () => {
  it("advances through the persisted first-launch sequence", () => {
    for (
      let index = 0;
      index < installationSetupStatuses.length - 1;
      index += 1
    ) {
      expect(
        installationSetupTransitionAllowed(
          installationSetupStatuses[index]!,
          installationSetupStatuses[index + 1]!,
        ),
      ).toBe(true);
    }
  });

  it("allows resume at the same step but rejects skipped, repeated, and reverse setup", () => {
    expect(
      installationSetupTransitionAllowed(
        "BOOTSTRAP_IN_PROGRESS",
        "BOOTSTRAP_IN_PROGRESS",
      ),
    ).toBe(true);
    expect(() =>
      requireInstallationSetupTransition("NOT_STARTED", "ADMIN_CREATED"),
    ).toThrow("Invalid installation setup transition");
    expect(() =>
      requireInstallationSetupTransition("READY", "BOOTSTRAP_IN_PROGRESS"),
    ).toThrow("Invalid installation setup transition");
    expect(() =>
      requireInstallationSetupTransition(
        "CONFIGURATION_REQUIRED",
        "ADMIN_CREATED",
      ),
    ).toThrow("Invalid installation setup transition");
  });
});
