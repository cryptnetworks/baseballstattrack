CREATE TYPE "DiscordCadenceMode" AS ENUM (
  'EVENT_DRIVEN',
  'FIXED_INTERVAL',
  'MANUAL_ONLY'
);

CREATE TYPE "DiscordCatchUpPolicy" AS ENUM (
  'SKIP',
  'LATEST_ONLY'
);

ALTER TABLE "DiscordIntegrationSettings"
  ADD COLUMN "cadenceMode" "DiscordCadenceMode" NOT NULL DEFAULT 'FIXED_INTERVAL',
  ADD COLUMN "gameDayWindowEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gameDayStartMinute" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN "gameDayEndMinute" INTEGER NOT NULL DEFAULT 1380,
  ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "digestMinute" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN "catchUpPolicy" "DiscordCatchUpPolicy" NOT NULL DEFAULT 'LATEST_ONLY',
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "manualRefreshRequestedAt" TIMESTAMP(3),
  ADD COLUMN "nextScheduledEvaluationAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessfulUpdateAt" TIMESTAMP(3);

ALTER TABLE "DiscordIntegrationSettings"
  DROP CONSTRAINT "DiscordIntegrationSettings_values_check",
  ADD CONSTRAINT "DiscordIntegrationSettings_values_check" CHECK (
    "schemaVersion" = 1 AND
    "revision" >= 1 AND
    "cadenceSeconds" BETWEEN 60 AND 3600 AND
    "gameDayStartMinute" BETWEEN 0 AND 1439 AND
    "gameDayEndMinute" BETWEEN 0 AND 1439 AND
    "gameDayStartMinute" <> "gameDayEndMinute" AND
    "digestMinute" BETWEEN 0 AND 1439 AND
    cardinality("triggers") BETWEEN 1 AND 9 AND
    "discord_update_triggers_are_unique"("triggers") AND
    "quietStartMinute" BETWEEN 0 AND 1439 AND
    "quietEndMinute" BETWEEN 0 AND 1439 AND
    "quietStartMinute" <> "quietEndMinute" AND
    "quietTimeZone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$' AND
    ("enabled" = false OR "pausedAt" IS NULL) AND
    ("enabled" = true OR "manualRefreshRequestedAt" IS NULL) AND
    ("enabled" = true OR "nextScheduledEvaluationAt" IS NULL)
  );

CREATE INDEX "DiscordIntegrationSettings_nextScheduledEvaluationAt_id_idx"
  ON "DiscordIntegrationSettings"("nextScheduledEvaluationAt", "id")
  WHERE "enabled" = true AND "nextScheduledEvaluationAt" IS NOT NULL;
