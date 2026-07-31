-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookEventName" AS ENUM ('GAME_VERIFIED', 'GAME_CORRECTED', 'REPORT_READY', 'SEASON_REPORT_UPDATED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookAttemptOutcome" AS ENUM ('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE', 'CANCELLED');

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "subscribedEvents" "WebhookEventName"[],
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "eventName" "WebhookEventName" NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "deduplicationKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "replayNumber" INTEGER NOT NULL DEFAULT 0,
    "secretVersion" INTEGER NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastFailureCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "replayRequestedAt" TIMESTAMP(3),
    "replayRequestedById" TEXT,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" "WebhookAttemptOutcome" NOT NULL,
    "responseStatus" INTEGER,
    "failureCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_accountId_status_idx" ON "WebhookEndpoint"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_accountId_id_key" ON "WebhookEndpoint"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_accountId_externalId_key" ON "WebhookEndpoint"("accountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_accountId_url_key" ON "WebhookEndpoint"("accountId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_externalId_key" ON "WebhookEvent"("externalId");

-- CreateIndex
CREATE INDEX "WebhookEvent_accountId_eventName_occurredAt_idx" ON "WebhookEvent"("accountId", "eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_retentionUntil_idx" ON "WebhookEvent"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_accountId_id_key" ON "WebhookEvent"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_accountId_deduplicationKey_key" ON "WebhookEvent"("accountId", "deduplicationKey");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_accountId_sequence_key" ON "WebhookEvent"("accountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_externalId_key" ON "WebhookDelivery"("externalId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_leaseExpiresAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_accountId_endpointId_status_createdAt_idx" ON "WebhookDelivery"("accountId", "endpointId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_retentionUntil_idx" ON "WebhookDelivery"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_accountId_id_key" ON "WebhookDelivery"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_replayNumber_key" ON "WebhookDelivery"("endpointId", "eventId", "replayNumber");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_accountId_completedAt_idx" ON "WebhookDeliveryAttempt"("accountId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_accountId_id_key" ON "WebhookDeliveryAttempt"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_deliveryId_attemptNumber_key" ON "WebhookDeliveryAttempt"("deliveryId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_accountId_endpointId_fkey" FOREIGN KEY ("accountId", "endpointId") REFERENCES "WebhookEndpoint"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_accountId_eventId_fkey" FOREIGN KEY ("accountId", "eventId") REFERENCES "WebhookEvent"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_accountId_deliveryId_fkey" FOREIGN KEY ("accountId", "deliveryId") REFERENCES "WebhookDelivery"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-only lifecycle and bounded-value constraints.
ALTER TABLE "WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_secret_version_check"
  CHECK ("secretVersion" > 0),
  ADD CONSTRAINT "WebhookEndpoint_subscriptions_check"
  CHECK (cardinality("subscribedEvents") > 0),
  ADD CONSTRAINT "WebhookEndpoint_lifecycle_check"
  CHECK (
    ("status" = 'PENDING_VERIFICATION' AND "verifiedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'ACTIVE' AND "verifiedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  );

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_version_retention_check"
  CHECK ("payloadVersion" = 1 AND "retentionUntil" > "occurredAt");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_values_check"
  CHECK (
    "replayNumber" >= 0
    AND "secretVersion" > 0
    AND "attemptCount" >= 0
    AND "retentionUntil" > "createdAt"
  ),
  ADD CONSTRAINT "WebhookDelivery_lifecycle_check"
  CHECK (
    ("status" = 'PENDING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "deliveredAt" IS NOT NULL AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("status" = 'DEAD_LETTER' AND "deadLetteredAt" IS NOT NULL AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
  );

ALTER TABLE "WebhookDeliveryAttempt"
  ADD CONSTRAINT "WebhookDeliveryAttempt_values_check"
  CHECK (
    "attemptNumber" > 0
    AND "durationMs" >= 0
    AND ("responseStatus" IS NULL OR "responseStatus" BETWEEN 100 AND 599)
    AND "completedAt" >= "startedAt"
  );

CREATE OR REPLACE FUNCTION "reject_webhook_event_update"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WebhookEvent records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WebhookEvent_immutable"
BEFORE UPDATE ON "WebhookEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_webhook_event_update"();

CREATE OR REPLACE FUNCTION "reject_webhook_endpoint_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."url" IS DISTINCT FROM OLD."url" THEN
    RAISE EXCEPTION 'WebhookEndpoint tenant, identity, and URL are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WebhookEndpoint_identity_immutable"
BEFORE UPDATE ON "WebhookEndpoint"
FOR EACH ROW EXECUTE FUNCTION "reject_webhook_endpoint_identity_update"();
