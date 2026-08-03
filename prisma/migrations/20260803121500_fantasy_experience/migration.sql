ALTER TYPE "WebhookEventName" ADD VALUE IF NOT EXISTS 'FANTASY_TRANSACTION_UPDATED';
ALTER TYPE "WebhookEventName" ADD VALUE IF NOT EXISTS 'FANTASY_SCORING_UPDATED';
ALTER TYPE "WebhookEventName" ADD VALUE IF NOT EXISTS 'FANTASY_MATCHUP_FINAL';

CREATE TYPE "NotificationDigestMode" AS ENUM ('IMMEDIATE', 'DAILY_DIGEST');
CREATE TYPE "FantasyWorkspaceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'PENDING_DELETION');
CREATE TYPE "FantasyWorkspaceVisibility" AS ENUM ('PRIVATE', 'LEAGUE_MEMBERS', 'PUBLIC_METADATA_ONLY');
CREATE TYPE "FantasyLeagueEventType" AS ENUM ('LEAGUE_CREATED', 'TRANSACTION_RECORDED', 'CONTROL_RECORDED', 'NOTIFICATION_SETTINGS_UPDATED');
CREATE TYPE "FantasyResultKind" AS ENUM ('TEAM_PERIOD', 'MATCHUP', 'STANDINGS');

CREATE TABLE "FantasyLeagueWorkspace" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FantasyWorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "FantasyWorkspaceVisibility" NOT NULL DEFAULT 'LEAGUE_MEMBERS',
    "rulesModelVersionId" TEXT NOT NULL,
    "rulesModelDigest" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "lineupDeadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "pausedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "deletionRequestedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FantasyLeagueWorkspace_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FantasyLeagueWorkspace_values_check" CHECK (
      btrim("name") <> '' AND
      char_length("name") <= 120 AND
      "revision" >= 0 AND
      "rulesModelVersionId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND
      "rulesModelDigest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      jsonb_typeof("snapshot") = 'object'
    ),
    CONSTRAINT "FantasyLeagueWorkspace_lifecycle_check" CHECK (
      ("status" = 'ACTIVE' AND "pausedAt" IS NULL AND "archivedAt" IS NULL AND "deletionRequestedAt" IS NULL) OR
      ("status" = 'PAUSED' AND "pausedAt" IS NOT NULL AND "archivedAt" IS NULL AND "deletionRequestedAt" IS NULL) OR
      ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL AND "deletionRequestedAt" IS NULL) OR
      ("status" = 'PENDING_DELETION' AND "deletionRequestedAt" IS NOT NULL)
    )
);

CREATE TABLE "FantasyLeagueEvent" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "fantasyLeagueId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" "FantasyLeagueEventType" NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyLeagueEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FantasyLeagueEvent_values_check" CHECK (
      btrim("operationId") <> '' AND
      char_length("operationId") <= 128 AND
      btrim("actorId") <> '' AND
      char_length("actorId") <= 128 AND
      "payloadDigest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      jsonb_typeof("payload") = 'object'
    )
);

CREATE TABLE "FantasyResultSnapshot" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "fantasyLeagueId" TEXT NOT NULL,
    "kind" "FantasyResultKind" NOT NULL,
    "logicalId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "previousSnapshotId" TEXT,
    "resultStatus" TEXT NOT NULL,
    "periodSequence" INTEGER,
    "fantasyModelVersionId" TEXT NOT NULL,
    "fantasyModelDigest" TEXT NOT NULL,
    "baseballRulesetVersionIds" TEXT[] NOT NULL,
    "statisticDerivationVersions" INTEGER[] NOT NULL,
    "sourceRevisions" INTEGER[] NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "resultDigest" TEXT NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "finalizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyResultSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FantasyResultSnapshot_values_check" CHECK (
      btrim("logicalId") <> '' AND
      char_length("logicalId") <= 128 AND
      "revision" >= 0 AND
      ("revision" = 0) = ("previousSnapshotId" IS NULL) AND
      ("periodSequence" IS NULL OR "periodSequence" > 0) AND
      btrim("resultStatus") <> '' AND
      "fantasyModelVersionId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND
      "fantasyModelDigest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      cardinality("baseballRulesetVersionIds") > 0 AND
      cardinality("statisticDerivationVersions") > 0 AND
      cardinality("sourceRevisions") > 0 AND
      "sourceDigest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      "resultDigest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      jsonb_typeof("payload") = 'object'
    )
);

CREATE UNIQUE INDEX "FantasyLeagueWorkspace_accountId_id_key" ON "FantasyLeagueWorkspace"("accountId", "id");
CREATE UNIQUE INDEX "FantasyLeagueWorkspace_accountId_externalId_key" ON "FantasyLeagueWorkspace"("accountId", "externalId");
CREATE INDEX "FantasyLeagueWorkspace_accountId_status_updatedAt_idx" ON "FantasyLeagueWorkspace"("accountId", "status", "updatedAt");
CREATE INDEX "FantasyLeagueWorkspace_accountId_ownerMembershipId_status_idx" ON "FantasyLeagueWorkspace"("accountId", "ownerMembershipId", "status");
CREATE INDEX "FantasyLeagueWorkspace_accountId_seasonId_status_idx" ON "FantasyLeagueWorkspace"("accountId", "seasonId", "status");

CREATE UNIQUE INDEX "FantasyLeagueEvent_accountId_id_key" ON "FantasyLeagueEvent"("accountId", "id");
CREATE UNIQUE INDEX "FantasyLeagueEvent_accountId_externalId_key" ON "FantasyLeagueEvent"("accountId", "externalId");
CREATE UNIQUE INDEX "FantasyLeagueEvent_fantasyLeagueId_operationId_key" ON "FantasyLeagueEvent"("fantasyLeagueId", "operationId");
CREATE INDEX "FantasyLeagueEvent_accountId_fantasyLeagueId_acceptedAt_id_idx" ON "FantasyLeagueEvent"("accountId", "fantasyLeagueId", "acceptedAt", "id");
CREATE INDEX "FantasyLeagueEvent_actorUserId_acceptedAt_idx" ON "FantasyLeagueEvent"("actorUserId", "acceptedAt");

CREATE UNIQUE INDEX "FantasyResultSnapshot_accountId_id_key" ON "FantasyResultSnapshot"("accountId", "id");
CREATE UNIQUE INDEX "FantasyResultSnapshot_accountId_fantasyLeagueId_id_key" ON "FantasyResultSnapshot"("accountId", "fantasyLeagueId", "id");
CREATE UNIQUE INDEX "FantasyResultSnapshot_fantasyLeagueId_kind_logicalId_revision_k" ON "FantasyResultSnapshot"("fantasyLeagueId", "kind", "logicalId", "revision");
CREATE INDEX "FantasyResultSnapshot_accountId_fantasyLeagueId_kind_calculated" ON "FantasyResultSnapshot"("accountId", "fantasyLeagueId", "kind", "calculatedAt");
CREATE INDEX "FantasyResultSnapshot_accountId_fantasyLeagueId_periodSequence_kind_idx" ON "FantasyResultSnapshot"("accountId", "fantasyLeagueId", "periodSequence", "kind");
CREATE INDEX "FantasyResultSnapshot_accountId_fantasyLeagueId_previousSnapshotId_idx" ON "FantasyResultSnapshot"("accountId", "fantasyLeagueId", "previousSnapshotId");

ALTER TABLE "FantasyLeagueWorkspace" ADD CONSTRAINT "FantasyLeagueWorkspace_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FantasyLeagueWorkspace" ADD CONSTRAINT "FantasyLeagueWorkspace_accountId_seasonId_fkey" FOREIGN KEY ("accountId", "seasonId") REFERENCES "Season"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FantasyLeagueWorkspace" ADD CONSTRAINT "FantasyLeagueWorkspace_accountId_ownerMembershipId_fkey" FOREIGN KEY ("accountId", "ownerMembershipId") REFERENCES "AccountMembership"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyLeagueEvent" ADD CONSTRAINT "FantasyLeagueEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FantasyLeagueEvent" ADD CONSTRAINT "FantasyLeagueEvent_accountId_fantasyLeagueId_fkey" FOREIGN KEY ("accountId", "fantasyLeagueId") REFERENCES "FantasyLeagueWorkspace"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FantasyLeagueEvent" ADD CONSTRAINT "FantasyLeagueEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyResultSnapshot" ADD CONSTRAINT "FantasyResultSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FantasyResultSnapshot" ADD CONSTRAINT "FantasyResultSnapshot_accountId_fantasyLeagueId_fkey" FOREIGN KEY ("accountId", "fantasyLeagueId") REFERENCES "FantasyLeagueWorkspace"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FantasyResultSnapshot" ADD CONSTRAINT "FantasyResultSnapshot_revision_fkey" FOREIGN KEY ("accountId", "fantasyLeagueId", "previousSnapshotId") REFERENCES "FantasyResultSnapshot"("accountId", "fantasyLeagueId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD COLUMN "fantasyLeagueId" TEXT,
  ADD COLUMN "recipientEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "digestMode" "NotificationDigestMode" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "digestMinute" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quietStartMinute" INTEGER NOT NULL DEFAULT 1320,
  ADD COLUMN "quietEndMinute" INTEGER NOT NULL DEFAULT 420;

ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_scope_check";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_scope_check" CHECK (
  ("teamId" IS NULL AND "fantasyLeagueId" IS NULL AND "scopeKey" = 'ACCOUNT') OR
  ("teamId" IS NOT NULL AND "fantasyLeagueId" IS NULL AND "scopeKey" = 'TEAM:' || "teamId") OR
  ("teamId" IS NULL AND "fantasyLeagueId" IS NOT NULL AND "scopeKey" = 'FANTASY_LEAGUE:' || "fantasyLeagueId")
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_schedule_check" CHECK (
  "digestMinute" BETWEEN 0 AND 1439 AND
  "quietStartMinute" BETWEEN 0 AND 1439 AND
  "quietEndMinute" BETWEEN 0 AND 1439 AND
  "quietStartMinute" <> "quietEndMinute" AND
  "timeZone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'
);
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_subscriptions_check";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_subscriptions_check" CHECK (
  cardinality("subscribedEvents") BETWEEN 1 AND 9
);
CREATE INDEX "NotificationPreference_accountId_fantasyLeagueId_status_idx" ON "NotificationPreference"("accountId", "fantasyLeagueId", "status");
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_fantasyLeagueId_fkey" FOREIGN KEY ("accountId", "fantasyLeagueId") REFERENCES "FantasyLeagueWorkspace"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "protect_fantasy_workspace_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."seasonId" IS DISTINCT FROM OLD."seasonId"
     OR NEW."ownerMembershipId" IS DISTINCT FROM OLD."ownerMembershipId"
     OR NEW."rulesModelVersionId" IS DISTINCT FROM OLD."rulesModelVersionId"
     OR NEW."rulesModelDigest" IS DISTINCT FROM OLD."rulesModelDigest"
     OR NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'fantasy workspace identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'fantasy workspace revision must advance exactly once' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "prevent_fantasy_history_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fantasy history is append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER "FantasyLeagueWorkspace_identity_immutable"
BEFORE UPDATE ON "FantasyLeagueWorkspace"
FOR EACH ROW EXECUTE FUNCTION "protect_fantasy_workspace_identity"();

CREATE TRIGGER "FantasyLeagueEvent_append_only"
BEFORE UPDATE OR DELETE ON "FantasyLeagueEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_fantasy_history_mutation"();

CREATE TRIGGER "FantasyResultSnapshot_append_only"
BEFORE UPDATE OR DELETE ON "FantasyResultSnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_fantasy_history_mutation"();

REVOKE ALL ON FUNCTION "protect_fantasy_workspace_identity"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "prevent_fantasy_history_mutation"() FROM PUBLIC;

ALTER TABLE "FantasyLeagueWorkspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FantasyLeagueEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FantasyResultSnapshot" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'FantasyLeagueWorkspace', api_role);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'FantasyLeagueEvent', api_role);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'FantasyResultSnapshot', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION %I() FROM %I', 'protect_fantasy_workspace_identity', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION %I() FROM %I', 'prevent_fantasy_history_mutation', api_role);
    END IF;
  END LOOP;
END;
$$;
