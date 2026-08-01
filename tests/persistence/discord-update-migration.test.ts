import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260801070000_discord_update_delivery/migration.sql",
  "utf8",
);
const indexMigration = readFileSync(
  "prisma/migrations/20260801071000_discord_update_delivery_indexes/migration.sql",
  "utf8",
);

describe("Discord update delivery migration", () => {
  it("persists deduplicated ordered work and immutable attempt evidence", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DiscordUpdateEvaluation_settingsId_gameId_settingsRevision__key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DiscordUpdateDelivery_evaluationId_destinationId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DiscordUpdateDeliveryAttempt_deliveryId_attemptNumber_key"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "DiscordUpdateDeliveryAttempt_append_only"',
    );
  });

  it("enables service-only RLS on every new table", () => {
    for (const table of [
      "DiscordUpdateEvaluation",
      "DiscordUpdateDelivery",
      "DiscordUpdateDeliveryAttempt",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      expect(migration).toContain(
        `format('REVOKE ALL ON TABLE %I FROM %I', '${table}', api_role)`,
      );
    }
    expect(migration).not.toMatch(/CREATE POLICY/iu);
  });

  it("bounds leases, attempts, message size, and retention", () => {
    expect(migration).toMatch(/"attemptCount" BETWEEN 0 AND 8/gu);
    expect(migration).toContain('char_length("content") BETWEEN 1 AND 2000');
    expect(migration).toContain(
      '"status" = \'PROCESSING\' AND "leaseOwner" IS NOT NULL',
    );
    expect(migration).toMatch(/"retentionUntil" > "createdAt"/gu);
  });

  it("covers each composite foreign-key access path", () => {
    for (const name of [
      "DiscordUpdateEvaluation_accountId_gameId_idx",
      "DiscordUpdateDelivery_accountId_destinationId_idx",
      "DiscordUpdateDelivery_accountId_evaluationId_idx",
      "DiscordUpdateDelivery_accountId_gameId_idx",
      "DiscordUpdateDeliveryAttempt_accountId_deliveryId_idx",
    ]) {
      expect(indexMigration).toContain(`CREATE INDEX "${name}"`);
    }
  });
});
