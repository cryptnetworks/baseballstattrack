ALTER TYPE "DiscordUpdateTrigger" ADD VALUE IF NOT EXISTS 'LEAD_CHANGED';
ALTER TYPE "DiscordUpdateTrigger" ADD VALUE IF NOT EXISTS 'SCORING_PLAY';
ALTER TYPE "DiscordUpdateTrigger" ADD VALUE IF NOT EXISTS 'PITCHING_CHANGED';

CREATE TYPE "DiscordMessageStrategy" AS ENUM (
  'EDIT_LIVE_MESSAGE',
  'APPEND_EVENTS',
  'PERIODIC_SUMMARY',
  'FINAL_ONLY'
);

ALTER TABLE "DiscordIntegrationSettings"
  ADD COLUMN "messageStrategy" "DiscordMessageStrategy" NOT NULL DEFAULT 'FINAL_ONLY';

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
    cardinality("triggers") BETWEEN 1 AND 12 AND
    "discord_update_triggers_are_unique"("triggers") AND
    "quietStartMinute" BETWEEN 0 AND 1439 AND
    "quietEndMinute" BETWEEN 0 AND 1439 AND
    "quietStartMinute" <> "quietEndMinute" AND
    "quietTimeZone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$' AND
    ("enabled" = false OR "pausedAt" IS NULL) AND
    ("enabled" = true OR "manualRefreshRequestedAt" IS NULL) AND
    ("enabled" = true OR "nextScheduledEvaluationAt" IS NULL)
  );
