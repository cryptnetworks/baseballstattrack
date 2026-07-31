CREATE TYPE "DiscordInstallationStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISCONNECTED', 'REVOKED');
CREATE TYPE "DiscordMessageFormat" AS ENUM ('COMPACT', 'STANDARD', 'DETAILED');
CREATE TYPE "DiscordUpdateTrigger" AS ENUM ('GAME_SCHEDULED', 'GAME_STARTED', 'SCORE_CHANGED', 'INNING_ENDED', 'GAME_COMPLETED', 'GAME_VERIFIED', 'GAME_CORRECTED', 'REPORT_READY', 'OPERATIONAL_FAILURE');
CREATE TYPE "DiscordDestinationPurpose" AS ENUM ('LIVE_UPDATES', 'REPORTS', 'OPERATIONS');

CREATE FUNCTION "discord_update_triggers_are_unique"("values" "DiscordUpdateTrigger"[])
RETURNS BOOLEAN AS $$
  SELECT count(*) = count(DISTINCT value) FROM unnest("values") AS value;
$$ LANGUAGE SQL IMMUTABLE;

CREATE TABLE "DiscordInstallation" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildDisplayName" TEXT,
    "credentialReference" TEXT NOT NULL,
    "status" "DiscordInstallationStatus" NOT NULL DEFAULT 'PENDING',
    "installedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordInstallation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscordInstallation_identity_check" CHECK (
      "guildId" ~ '^[0-9]{2,32}$' AND
      "credentialReference" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
    ),
    CONSTRAINT "DiscordInstallation_lifecycle_check" CHECK (
      ("status" = 'PENDING' AND "installedAt" IS NULL AND "disconnectedAt" IS NULL AND "revokedAt" IS NULL) OR
      ("status" = 'ACTIVE' AND "installedAt" IS NOT NULL AND "disconnectedAt" IS NULL AND "revokedAt" IS NULL) OR
      ("status" = 'DISCONNECTED' AND "installedAt" IS NOT NULL AND "disconnectedAt" IS NOT NULL AND "revokedAt" IS NULL) OR
      ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
    )
);

CREATE TABLE "DiscordChannelDestination" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelReference" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordChannelDestination_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscordChannelDestination_identity_check" CHECK (
      "channelId" ~ '^[0-9]{2,32}$' AND
      "channelReference" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
    )
);

CREATE TABLE "DiscordIntegrationSettings" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cadenceSeconds" INTEGER NOT NULL DEFAULT 300,
    "triggers" "DiscordUpdateTrigger"[] NOT NULL DEFAULT ARRAY['GAME_COMPLETED', 'GAME_VERIFIED', 'GAME_CORRECTED']::"DiscordUpdateTrigger"[],
    "messageFormat" "DiscordMessageFormat" NOT NULL DEFAULT 'STANDARD',
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStartMinute" INTEGER NOT NULL DEFAULT 1320,
    "quietEndMinute" INTEGER NOT NULL DEFAULT 420,
    "quietTimeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordIntegrationSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscordIntegrationSettings_values_check" CHECK (
      "schemaVersion" = 1 AND
      "revision" >= 1 AND
      "cadenceSeconds" BETWEEN 15 AND 86400 AND
      cardinality("triggers") BETWEEN 1 AND 9 AND
      "discord_update_triggers_are_unique"("triggers") AND
      "quietStartMinute" BETWEEN 0 AND 1439 AND
      "quietEndMinute" BETWEEN 0 AND 1439 AND
      "quietStartMinute" <> "quietEndMinute" AND
      "quietTimeZone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'
    )
);

CREATE TABLE "DiscordSettingsScope" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "teamSeasonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordSettingsScope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscordSettingsDestination" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "purpose" "DiscordDestinationPurpose" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordSettingsDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscordInstallation_accountId_id_key" ON "DiscordInstallation"("accountId", "id");
CREATE UNIQUE INDEX "DiscordInstallation_accountId_externalId_key" ON "DiscordInstallation"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordInstallation_guildId_key" ON "DiscordInstallation"("guildId");
CREATE INDEX "DiscordInstallation_accountId_status_idx" ON "DiscordInstallation"("accountId", "status");

CREATE UNIQUE INDEX "DiscordChannelDestination_accountId_id_key" ON "DiscordChannelDestination"("accountId", "id");
CREATE UNIQUE INDEX "DiscordChannelDestination_accountId_externalId_key" ON "DiscordChannelDestination"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordChannelDestination_installationId_channelId_key" ON "DiscordChannelDestination"("installationId", "channelId");
CREATE UNIQUE INDEX "DiscordChannelDestination_installationId_channelReference_key" ON "DiscordChannelDestination"("installationId", "channelReference");
CREATE INDEX "DiscordChannelDestination_accountId_installationId_enabled_idx" ON "DiscordChannelDestination"("accountId", "installationId", "enabled");

CREATE UNIQUE INDEX "DiscordIntegrationSettings_accountId_id_key" ON "DiscordIntegrationSettings"("accountId", "id");
CREATE UNIQUE INDEX "DiscordIntegrationSettings_accountId_externalId_key" ON "DiscordIntegrationSettings"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordIntegrationSettings_accountId_installationId_key" ON "DiscordIntegrationSettings"("accountId", "installationId");
CREATE INDEX "DiscordIntegrationSettings_accountId_enabled_idx" ON "DiscordIntegrationSettings"("accountId", "enabled");

CREATE UNIQUE INDEX "DiscordSettingsScope_accountId_id_key" ON "DiscordSettingsScope"("accountId", "id");
CREATE UNIQUE INDEX "DiscordSettingsScope_settingsId_teamSeasonId_key" ON "DiscordSettingsScope"("settingsId", "teamSeasonId");
CREATE INDEX "DiscordSettingsScope_accountId_teamSeasonId_idx" ON "DiscordSettingsScope"("accountId", "teamSeasonId");

CREATE UNIQUE INDEX "DiscordSettingsDestination_accountId_id_key" ON "DiscordSettingsDestination"("accountId", "id");
CREATE UNIQUE INDEX "DiscordSettingsDestination_settingsId_destinationId_purpose_key" ON "DiscordSettingsDestination"("settingsId", "destinationId", "purpose");
CREATE INDEX "DiscordSettingsDestination_accountId_destinationId_idx" ON "DiscordSettingsDestination"("accountId", "destinationId");

ALTER TABLE "DiscordInstallation" ADD CONSTRAINT "DiscordInstallation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordChannelDestination" ADD CONSTRAINT "DiscordChannelDestination_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordChannelDestination" ADD CONSTRAINT "DiscordChannelDestination_accountId_installationId_fkey" FOREIGN KEY ("accountId", "installationId") REFERENCES "DiscordInstallation"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordIntegrationSettings" ADD CONSTRAINT "DiscordIntegrationSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordIntegrationSettings" ADD CONSTRAINT "DiscordIntegrationSettings_accountId_installationId_fkey" FOREIGN KEY ("accountId", "installationId") REFERENCES "DiscordInstallation"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordSettingsScope" ADD CONSTRAINT "DiscordSettingsScope_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordSettingsScope" ADD CONSTRAINT "DiscordSettingsScope_accountId_settingsId_fkey" FOREIGN KEY ("accountId", "settingsId") REFERENCES "DiscordIntegrationSettings"("accountId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscordSettingsScope" ADD CONSTRAINT "DiscordSettingsScope_accountId_teamSeasonId_fkey" FOREIGN KEY ("accountId", "teamSeasonId") REFERENCES "TeamSeason"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordSettingsDestination" ADD CONSTRAINT "DiscordSettingsDestination_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordSettingsDestination" ADD CONSTRAINT "DiscordSettingsDestination_accountId_settingsId_fkey" FOREIGN KEY ("accountId", "settingsId") REFERENCES "DiscordIntegrationSettings"("accountId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscordSettingsDestination" ADD CONSTRAINT "DiscordSettingsDestination_accountId_destinationId_fkey" FOREIGN KEY ("accountId", "destinationId") REFERENCES "DiscordChannelDestination"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "enforce_discord_enabled_settings"()
RETURNS trigger AS $$
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
        )
      )
  ) THEN
    RAISE EXCEPTION 'enabled Discord settings require an active installation, tracked scope, and same-installation destination' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "DiscordInstallation_enabled_settings_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordInstallation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_discord_enabled_settings"();

CREATE CONSTRAINT TRIGGER "DiscordChannelDestination_enabled_settings_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordChannelDestination"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_discord_enabled_settings"();

CREATE CONSTRAINT TRIGGER "DiscordIntegrationSettings_enabled_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordIntegrationSettings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_discord_enabled_settings"();

CREATE CONSTRAINT TRIGGER "DiscordSettingsScope_enabled_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordSettingsScope"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_discord_enabled_settings"();

CREATE CONSTRAINT TRIGGER "DiscordSettingsDestination_enabled_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordSettingsDestination"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_discord_enabled_settings"();

CREATE OR REPLACE FUNCTION "reject_discord_installation_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."guildId" IS DISTINCT FROM OLD."guildId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Discord installation identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DiscordInstallation_identity_immutable"
BEFORE UPDATE ON "DiscordInstallation"
FOR EACH ROW EXECUTE FUNCTION "reject_discord_installation_identity_update"();

CREATE OR REPLACE FUNCTION "reject_discord_destination_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
     OR NEW."channelId" IS DISTINCT FROM OLD."channelId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Discord destination identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DiscordChannelDestination_identity_immutable"
BEFORE UPDATE ON "DiscordChannelDestination"
FOR EACH ROW EXECUTE FUNCTION "reject_discord_destination_identity_update"();

CREATE OR REPLACE FUNCTION "reject_discord_settings_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
     OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Discord settings identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DiscordIntegrationSettings_identity_immutable"
BEFORE UPDATE ON "DiscordIntegrationSettings"
FOR EACH ROW EXECUTE FUNCTION "reject_discord_settings_identity_update"();
