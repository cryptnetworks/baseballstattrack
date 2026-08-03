import "dotenv/config";

import { readFile } from "node:fs/promises";

import pg from "pg";
import { z } from "zod";

const modes = ["validate", "apply", "rollback"];
const providers = ["authentik", "google", "discord", "facebook", "apple"];
const identity = z
  .object({
    provider: z.enum(providers),
    providerSubject: z.string().trim().min(1).max(1024),
  })
  .strict();
const mappingSchema = z
  .object({
    version: z.literal(1),
    mappings: z
      .array(
        z
          .object({
            appUserId: z.string().trim().min(1),
            existingIdentity: identity,
            targetIdentity: identity,
            reviewedByAppUserId: z.string().trim().min(1),
            reason: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const [mode, mappingPath] = process.argv.slice(2);
if (!modes.includes(mode) || !mappingPath) {
  throw new Error(
    "Usage: node scripts/migrate-authentication-identities.mjs <validate|apply|rollback> <reviewed-mapping.json>",
  );
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const mapping = mappingSchema.parse(
  JSON.parse(await readFile(mappingPath, "utf8")),
);
const duplicateTargets = new Set();
for (const item of mapping.mappings) {
  const key = `${item.targetIdentity.provider}\u0000${item.targetIdentity.providerSubject}`;
  if (duplicateTargets.has(key)) {
    throw new Error(
      "The reviewed mapping contains a duplicate target identity",
    );
  }
  duplicateTargets.add(key);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let changed = 0;
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reviewed-authentication-identity-migration', 0))",
  );
  for (const item of mapping.mappings) {
    const existing = await client.query(
      `SELECT "appUserId"
       FROM "AuthenticationIdentity"
       WHERE "provider" = $1 AND "providerSubject" = $2
       FOR UPDATE`,
      [item.existingIdentity.provider, item.existingIdentity.providerSubject],
    );
    if (existing.rows[0]?.appUserId !== item.appUserId) {
      throw new Error(
        "A reviewed mapping does not match the exact existing application identity",
      );
    }
    const reviewer = await client.query(
      `SELECT 1 FROM "AppUser" WHERE "id" = $1`,
      [item.reviewedByAppUserId],
    );
    if (reviewer.rowCount !== 1) {
      throw new Error("A reviewed mapping references an unknown reviewer");
    }
    const target = await client.query(
      `SELECT "id", "appUserId", "source", "linkedByAppUserId", "linkedReason"
       FROM "AuthenticationIdentity"
       WHERE "provider" = $1 AND "providerSubject" = $2
       FOR UPDATE`,
      [item.targetIdentity.provider, item.targetIdentity.providerSubject],
    );
    const exactReviewedTarget =
      target.rows[0]?.appUserId === item.appUserId &&
      target.rows[0]?.source === "REVIEWED_MIGRATION" &&
      target.rows[0]?.linkedByAppUserId === item.reviewedByAppUserId &&
      target.rows[0]?.linkedReason === item.reason;

    if (mode === "rollback") {
      if (!target.rowCount) continue;
      if (!exactReviewedTarget) {
        throw new Error(
          "Rollback refused because the target is not the exact reviewed migration identity",
        );
      }
      const sessions = await client.query(
        `SELECT 1 FROM "AuthenticationSession" WHERE "identityId" = $1 LIMIT 1`,
        [target.rows[0].id],
      );
      if (sessions.rowCount) {
        throw new Error(
          "Rollback refused because the migrated identity has session history",
        );
      }
      if (mode === "rollback") {
        await client.query(
          `DELETE FROM "AuthenticationIdentity" WHERE "id" = $1`,
          [target.rows[0].id],
        );
        changed += 1;
      }
      continue;
    }

    if (target.rowCount && !exactReviewedTarget) {
      throw new Error("A target provider subject is already owned");
    }
    if (mode === "apply" && !target.rowCount) {
      await client.query(
        `INSERT INTO "AuthenticationIdentity" (
           "id", "appUserId", "provider", "providerSubject", "source",
           "linkedByAppUserId", "linkedReason", "updatedAt"
         ) VALUES (
           gen_random_uuid()::text, $1, $2, $3, 'REVIEWED_MIGRATION', $4, $5, CURRENT_TIMESTAMP
         )`,
        [
          item.appUserId,
          item.targetIdentity.provider,
          item.targetIdentity.providerSubject,
          item.reviewedByAppUserId,
          item.reason,
        ],
      );
      changed += 1;
    }
  }
  if (mode === "validate") await client.query("ROLLBACK");
  else await client.query("COMMIT");
  process.stdout.write(
    `${mode} completed for ${mapping.mappings.length} reviewed mapping(s); ${changed} change(s)\n`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
