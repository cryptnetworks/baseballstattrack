CREATE TYPE "DiscordUpdateWorkStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'DEAD_LETTER',
  'CANCELLED'
);

CREATE TYPE "DiscordUpdateOperation" AS ENUM ('CREATE', 'EDIT', 'APPEND');

CREATE TYPE "DiscordUpdateAttemptOutcome" AS ENUM (
  'SUCCEEDED',
  'RETRYABLE_FAILURE',
  'TERMINAL_FAILURE',
  'CANCELLED'
);

CREATE TABLE "DiscordUpdateEvaluation" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "settingsId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "settingsRevision" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "trigger" "DiscordUpdateTrigger" NOT NULL,
  "status" "DiscordUpdateWorkStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "evaluatedAt" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "retentionUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiscordUpdateEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscordUpdateEvaluation_values_check" CHECK (
    "settingsRevision" >= 1 AND
    "sourceRevision" >= 0 AND
    "attemptCount" BETWEEN 0 AND 8 AND
    (("status" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR
     ("status" <> 'PROCESSING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)) AND
    (("status" = 'SUCCEEDED') = ("evaluatedAt" IS NOT NULL)) AND
    (("status" = 'DEAD_LETTER') = ("deadLetteredAt" IS NOT NULL)) AND
    (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)) AND
    "retentionUntil" > "createdAt"
  )
);

CREATE TABLE "DiscordUpdateDelivery" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "settingsId" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "settingsRevision" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "operation" "DiscordUpdateOperation" NOT NULL,
  "messageFormat" "DiscordMessageFormat" NOT NULL,
  "content" TEXT NOT NULL,
  "targetProviderMessageId" TEXT,
  "providerMessageId" TEXT,
  "status" "DiscordUpdateWorkStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "retentionUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiscordUpdateDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscordUpdateDelivery_values_check" CHECK (
    "settingsRevision" >= 1 AND
    "sourceRevision" >= 0 AND
    "attemptCount" BETWEEN 0 AND 8 AND
    char_length("content") BETWEEN 1 AND 2000 AND
    (("operation" = 'EDIT') = ("targetProviderMessageId" IS NOT NULL)) AND
    (("status" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR
     ("status" <> 'PROCESSING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)) AND
    (("status" = 'SUCCEEDED') = ("deliveredAt" IS NOT NULL)) AND
    (("status" = 'DEAD_LETTER') = ("deadLetteredAt" IS NOT NULL)) AND
    (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)) AND
    ("status" <> 'SUCCEEDED' OR "providerMessageId" IS NOT NULL) AND
    "retentionUntil" > "createdAt"
  )
);

CREATE TABLE "DiscordUpdateDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "outcome" "DiscordUpdateAttemptOutcome" NOT NULL,
  "responseStatus" INTEGER,
  "failureCode" TEXT,
  "durationMs" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiscordUpdateDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscordUpdateDeliveryAttempt_values_check" CHECK (
    "attemptNumber" BETWEEN 1 AND 8 AND
    "durationMs" >= 0 AND
    "completedAt" >= "startedAt" AND
    ("responseStatus" IS NULL OR "responseStatus" BETWEEN 100 AND 599)
  )
);

CREATE UNIQUE INDEX "DiscordUpdateEvaluation_accountId_id_key" ON "DiscordUpdateEvaluation"("accountId", "id");
CREATE UNIQUE INDEX "DiscordUpdateEvaluation_accountId_externalId_key" ON "DiscordUpdateEvaluation"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordUpdateEvaluation_settingsId_gameId_settingsRevision__key" ON "DiscordUpdateEvaluation"("settingsId", "gameId", "settingsRevision", "sourceRevision", "trigger");
CREATE INDEX "DiscordUpdateEvaluation_status_nextAttemptAt_leaseExpiresAt_idx" ON "DiscordUpdateEvaluation"("status", "nextAttemptAt", "leaseExpiresAt");
CREATE INDEX "DiscordUpdateEvaluation_accountId_settingsId_gameId_sourceR_idx" ON "DiscordUpdateEvaluation"("accountId", "settingsId", "gameId", "sourceRevision");
CREATE INDEX "DiscordUpdateEvaluation_retentionUntil_idx" ON "DiscordUpdateEvaluation"("retentionUntil");

CREATE UNIQUE INDEX "DiscordUpdateDelivery_accountId_id_key" ON "DiscordUpdateDelivery"("accountId", "id");
CREATE UNIQUE INDEX "DiscordUpdateDelivery_accountId_externalId_key" ON "DiscordUpdateDelivery"("accountId", "externalId");
CREATE UNIQUE INDEX "DiscordUpdateDelivery_evaluationId_destinationId_key" ON "DiscordUpdateDelivery"("evaluationId", "destinationId");
CREATE INDEX "DiscordUpdateDelivery_status_nextAttemptAt_leaseExpiresAt_idx" ON "DiscordUpdateDelivery"("status", "nextAttemptAt", "leaseExpiresAt");
CREATE INDEX "DiscordUpdateDelivery_accountId_settingsId_gameId_destinati_idx" ON "DiscordUpdateDelivery"("accountId", "settingsId", "gameId", "destinationId", "sourceRevision");
CREATE INDEX "DiscordUpdateDelivery_retentionUntil_idx" ON "DiscordUpdateDelivery"("retentionUntil");

CREATE UNIQUE INDEX "DiscordUpdateDeliveryAttempt_accountId_id_key" ON "DiscordUpdateDeliveryAttempt"("accountId", "id");
CREATE UNIQUE INDEX "DiscordUpdateDeliveryAttempt_deliveryId_attemptNumber_key" ON "DiscordUpdateDeliveryAttempt"("deliveryId", "attemptNumber");
CREATE INDEX "DiscordUpdateDeliveryAttempt_accountId_completedAt_idx" ON "DiscordUpdateDeliveryAttempt"("accountId", "completedAt");

ALTER TABLE "DiscordUpdateEvaluation" ADD CONSTRAINT "DiscordUpdateEvaluation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateEvaluation" ADD CONSTRAINT "DiscordUpdateEvaluation_accountId_settingsId_fkey" FOREIGN KEY ("accountId", "settingsId") REFERENCES "DiscordIntegrationSettings"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateEvaluation" ADD CONSTRAINT "DiscordUpdateEvaluation_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscordUpdateDelivery" ADD CONSTRAINT "DiscordUpdateDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateDelivery" ADD CONSTRAINT "DiscordUpdateDelivery_accountId_settingsId_fkey" FOREIGN KEY ("accountId", "settingsId") REFERENCES "DiscordIntegrationSettings"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateDelivery" ADD CONSTRAINT "DiscordUpdateDelivery_accountId_evaluationId_fkey" FOREIGN KEY ("accountId", "evaluationId") REFERENCES "DiscordUpdateEvaluation"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateDelivery" ADD CONSTRAINT "DiscordUpdateDelivery_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateDelivery" ADD CONSTRAINT "DiscordUpdateDelivery_accountId_destinationId_fkey" FOREIGN KEY ("accountId", "destinationId") REFERENCES "DiscordChannelDestination"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiscordUpdateDeliveryAttempt" ADD CONSTRAINT "DiscordUpdateDeliveryAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscordUpdateDeliveryAttempt" ADD CONSTRAINT "DiscordUpdateDeliveryAttempt_accountId_deliveryId_fkey" FOREIGN KEY ("accountId", "deliveryId") REFERENCES "DiscordUpdateDelivery"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_discord_update_attempt_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Discord update delivery attempts are immutable' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

CREATE TRIGGER "DiscordUpdateDeliveryAttempt_append_only"
BEFORE UPDATE OR DELETE ON "DiscordUpdateDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION "reject_discord_update_attempt_mutation"();

REVOKE ALL ON FUNCTION "reject_discord_update_attempt_mutation"() FROM PUBLIC;

ALTER TABLE "DiscordUpdateEvaluation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscordUpdateDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscordUpdateDeliveryAttempt" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'DiscordUpdateEvaluation', api_role);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'DiscordUpdateDelivery', api_role);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'DiscordUpdateDeliveryAttempt', api_role);
    END IF;
  END LOOP;
END;
$$;
