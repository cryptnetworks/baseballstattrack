-- Expand destination routing from broad buckets to the six administrator-facing
-- categories. Existing report and operations routes retain their closest safe
-- meaning; no new delivery category is enabled implicitly.
ALTER TYPE "DiscordDestinationPurpose" RENAME TO "DiscordDestinationPurpose_legacy";
CREATE TYPE "DiscordDestinationPurpose" AS ENUM (
  'LIVE_UPDATES',
  'FINAL_SCORES',
  'CORRECTIONS',
  'SUMMARIES',
  'ERRORS',
  'DIGESTS'
);
ALTER TABLE "DiscordSettingsDestination"
  ALTER COLUMN "purpose" TYPE "DiscordDestinationPurpose"
  USING (
    CASE "purpose"::text
      WHEN 'LIVE_UPDATES' THEN 'LIVE_UPDATES'
      WHEN 'REPORTS' THEN 'SUMMARIES'
      WHEN 'OPERATIONS' THEN 'ERRORS'
    END
  )::"DiscordDestinationPurpose";
DROP TYPE "DiscordDestinationPurpose_legacy";

-- Administrator enablement and live Discord permission evidence are separate.
ALTER TABLE "DiscordChannelDestination"
  ADD COLUMN "canView" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canSend" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);

DROP INDEX "DiscordChannelDestination_accountId_installationId_enabled_idx";
CREATE INDEX "DiscordChannelDestination_accountId_installationId_enabled_canView_canSend_idx"
  ON "DiscordChannelDestination"("accountId", "installationId", "enabled", "canView", "canSend");

CREATE OR REPLACE FUNCTION "enforce_discord_enabled_settings"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected_account_id TEXT;
BEGIN
  affected_account_id := COALESCE(NEW."accountId", OLD."accountId");
  IF EXISTS (
    SELECT 1
    FROM "DiscordIntegrationSettings" settings
    JOIN "DiscordInstallation" installation
      ON installation."accountId" = settings."accountId"
     AND installation."id" = settings."installationId"
    WHERE settings."accountId" = affected_account_id
      AND settings."enabled" = true
      AND (
        installation."status" <> 'ACTIVE' OR
        NOT EXISTS (
          SELECT 1 FROM "DiscordSettingsScope" scope
          WHERE scope."accountId" = settings."accountId"
            AND scope."settingsId" = settings."id"
        ) OR
        NOT EXISTS (
          SELECT 1
          FROM "DiscordSettingsDestination" route
          JOIN "DiscordChannelDestination" destination
            ON destination."accountId" = route."accountId"
           AND destination."id" = route."destinationId"
          WHERE route."accountId" = settings."accountId"
            AND route."settingsId" = settings."id"
            AND destination."installationId" = settings."installationId"
            AND destination."enabled" = true
            AND destination."canView" = true
            AND destination."canSend" = true
        )
      )
  ) THEN
    RAISE EXCEPTION 'enabled Discord settings require an active installation, tracked scope, and routable same-installation destination' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
