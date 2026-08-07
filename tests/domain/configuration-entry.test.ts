import { describe, expect, it } from "vitest";

import { configurationEntrySchema } from "@/domain/configuration-entry";

describe("configuration entry secret boundary", () => {
  it("accepts non-sensitive values", () => {
    expect(
      configurationEntrySchema.parse({
        key: "discord.enabled",
        category: "DISCORD",
        scope: "ACCOUNT",
        accountId: "account-a",
        ownerId: "user-a",
        visibility: "ADMIN",
        value: true,
        secretReference: null,
      }).value,
    ).toBe(true);
  });

  it("requires a reference instead of accepting a secret value", () => {
    expect(() =>
      configurationEntrySchema.parse({
        key: "discord.botToken",
        category: "DISCORD",
        scope: "ACCOUNT",
        accountId: "account-a",
        ownerId: "user-a",
        visibility: "ADMIN",
        value: "actual-token",
        secretReference: null,
      }),
    ).toThrow();
    expect(() =>
      configurationEntrySchema.parse({
        key: "discord.settings",
        category: "DISCORD",
        scope: "ACCOUNT",
        accountId: "account-a",
        ownerId: "user-a",
        visibility: "ADMIN",
        value: { nested: { password: "actual-secret" } },
        secretReference: null,
      }),
    ).toThrow();
    expect(
      configurationEntrySchema.parse({
        key: "discord.botToken",
        category: "DISCORD",
        scope: "ACCOUNT",
        accountId: "account-a",
        ownerId: "user-a",
        visibility: "ADMIN",
        value: null,
        secretReference: {
          provider: "VAULT",
          referenceIdentifier: "baseball/discord-token",
          environment: "local",
        },
      }).secretReference?.referenceIdentifier,
    ).toBe("baseball/discord-token");
  });
});
