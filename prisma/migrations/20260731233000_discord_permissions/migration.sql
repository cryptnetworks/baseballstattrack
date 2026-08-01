CREATE TYPE "DiscordControlAction" AS ENUM ('READ_ONLY', 'CONFIGURE', 'PREVIEW', 'OPERATE');
CREATE TYPE "DiscordRoleGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE FUNCTION "discord_control_actions_are_unique"("values" "DiscordControlAction"[])
RETURNS BOOLEAN AS $$
  SELECT count(*) = count(DISTINCT value) FROM unnest("values") AS value;
$$ LANGUAGE SQL IMMUTABLE;

CREATE TABLE "DiscordGuildRole" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleReference" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordGuildRole_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscordGuildRole_identity_check" CHECK (
      "roleId" ~ '^[0-9]{2,32}$' AND
      "roleReference" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
    )
);

CREATE TABLE "DiscordRoleGrant" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "guildRoleId" TEXT NOT NULL,
    "actions" "DiscordControlAction"[] NOT NULL,
    "status" "DiscordRoleGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordRoleGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscordRoleGrant_values_check" CHECK (
      "revision" >= 1 AND
      cardinality("actions") BETWEEN 1 AND 4 AND
      "discord_control_actions_are_unique"("actions")
    ),
    CONSTRAINT "DiscordRoleGrant_lifecycle_check" CHECK (
      ("status" = 'ACTIVE' AND "revokedAt" IS NULL) OR
      ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "DiscordGuildRole_accountId_id_key" ON "DiscordGuildRole"("accountId", "id");
CREATE UNIQUE INDEX "DiscordGuildRole_accountId_installationId_id_key" ON "DiscordGuildRole"("accountId", "installationId", "id");
CREATE UNIQUE INDEX "DiscordGuildRole_accountId_externalId_key" ON "DiscordGuildRole"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordGuildRole_installationId_roleId_key" ON "DiscordGuildRole"("installationId", "roleId");
CREATE UNIQUE INDEX "DiscordGuildRole_installationId_roleReference_key" ON "DiscordGuildRole"("installationId", "roleReference");
CREATE INDEX "DiscordGuildRole_accountId_installationId_enabled_idx" ON "DiscordGuildRole"("accountId", "installationId", "enabled");

CREATE UNIQUE INDEX "DiscordRoleGrant_accountId_id_key" ON "DiscordRoleGrant"("accountId", "id");
CREATE UNIQUE INDEX "DiscordRoleGrant_accountId_externalId_key" ON "DiscordRoleGrant"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordRoleGrant_accountId_installationId_guildRoleId_key" ON "DiscordRoleGrant"("accountId", "installationId", "guildRoleId");
CREATE INDEX "DiscordRoleGrant_accountId_installationId_status_idx" ON "DiscordRoleGrant"("accountId", "installationId", "status");

ALTER TABLE "DiscordGuildRole" ADD CONSTRAINT "DiscordGuildRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordGuildRole" ADD CONSTRAINT "DiscordGuildRole_accountId_installationId_fkey" FOREIGN KEY ("accountId", "installationId") REFERENCES "DiscordInstallation"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordRoleGrant" ADD CONSTRAINT "DiscordRoleGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordRoleGrant" ADD CONSTRAINT "DiscordRoleGrant_accountId_installationId_fkey" FOREIGN KEY ("accountId", "installationId") REFERENCES "DiscordInstallation"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordRoleGrant" ADD CONSTRAINT "DiscordRoleGrant_accountId_installationId_guildRoleId_fkey" FOREIGN KEY ("accountId", "installationId", "guildRoleId") REFERENCES "DiscordGuildRole"("accountId", "installationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_discord_guild_role_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
     OR NEW."roleId" IS DISTINCT FROM OLD."roleId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Discord guild role identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DiscordGuildRole_identity_immutable"
BEFORE UPDATE ON "DiscordGuildRole"
FOR EACH ROW EXECUTE FUNCTION "reject_discord_guild_role_identity_update"();

CREATE OR REPLACE FUNCTION "reject_discord_role_grant_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
     OR NEW."guildRoleId" IS DISTINCT FROM OLD."guildRoleId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Discord role grant identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DiscordRoleGrant_identity_immutable"
BEFORE UPDATE ON "DiscordRoleGrant"
FOR EACH ROW EXECUTE FUNCTION "reject_discord_role_grant_identity_update"();

CREATE OR REPLACE FUNCTION "enforce_active_discord_role_grant"()
RETURNS trigger AS $$
DECLARE
  affected_account_id TEXT;
BEGIN
  affected_account_id := COALESCE(NEW."accountId", OLD."accountId");
  IF EXISTS (
    SELECT 1
    FROM "DiscordRoleGrant" grant_record
    JOIN "DiscordInstallation" installation
      ON installation."accountId" = grant_record."accountId"
     AND installation."id" = grant_record."installationId"
    JOIN "DiscordGuildRole" guild_role
      ON guild_role."accountId" = grant_record."accountId"
     AND guild_role."installationId" = grant_record."installationId"
     AND guild_role."id" = grant_record."guildRoleId"
    WHERE grant_record."accountId" = affected_account_id
      AND grant_record."status" = 'ACTIVE'
      AND (installation."status" <> 'ACTIVE' OR guild_role."enabled" = false)
  ) THEN
    RAISE EXCEPTION 'active Discord role grants require an active installation and enabled guild role' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "DiscordInstallation_active_role_grant_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordInstallation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_active_discord_role_grant"();

CREATE CONSTRAINT TRIGGER "DiscordGuildRole_active_grant_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordGuildRole"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_active_discord_role_grant"();

CREATE CONSTRAINT TRIGGER "DiscordRoleGrant_active_guard"
AFTER INSERT OR UPDATE OR DELETE ON "DiscordRoleGrant"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_active_discord_role_grant"();
