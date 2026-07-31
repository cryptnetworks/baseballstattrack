ALTER TYPE "WebhookEventName" ADD VALUE IF NOT EXISTS 'GAME_COMPLETED';
ALTER TYPE "WebhookEventName" ADD VALUE IF NOT EXISTS 'OPERATIONAL_FAILURE';

ALTER TABLE "WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_subscriptions_check";
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_subscriptions_check" CHECK (
  cardinality("subscribedEvents") BETWEEN 1 AND 6
);

CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'DISCORD');
CREATE TYPE "NotificationPreferenceStatus" AS ENUM ('ACTIVE', 'OPTED_OUT', 'DISABLED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELLED');
CREATE TYPE "NotificationAttemptOutcome" AS ENUM ('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE', 'CANCELLED');

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "teamId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "destinationReference" TEXT NOT NULL,
    "subscribedEvents" "WebhookEventName"[],
    "status" "NotificationPreferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "sensitiveContent" BOOLEAN NOT NULL DEFAULT false,
    "optedOutAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationPreference_scope_check" CHECK (
      ("teamId" IS NULL AND "scopeKey" = 'ACCOUNT') OR
      ("teamId" IS NOT NULL AND "scopeKey" = 'TEAM:' || "teamId")
    ),
    CONSTRAINT "NotificationPreference_destination_check" CHECK (
      "destinationReference" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
    ),
    CONSTRAINT "NotificationPreference_subscriptions_check" CHECK (
      cardinality("subscribedEvents") BETWEEN 1 AND 6
    ),
    CONSTRAINT "NotificationPreference_privacy_check" CHECK ("sensitiveContent" = false),
    CONSTRAINT "NotificationPreference_lifecycle_check" CHECK (
      ("status" = 'ACTIVE' AND "optedOutAt" IS NULL AND "disabledAt" IS NULL) OR
      ("status" = 'OPTED_OUT' AND "optedOutAt" IS NOT NULL AND "disabledAt" IS NULL) OR
      ("status" = 'DISABLED' AND "optedOutAt" IS NULL AND "disabledAt" IS NOT NULL)
    )
);

CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "destinationReference" TEXT NOT NULL,
    "messageVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
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

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationDelivery_values_check" CHECK (
      "messageVersion" = 1 AND
      "attemptCount" >= 0 AND
      "retentionUntil" > "createdAt" AND
      "destinationReference" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
    ),
    CONSTRAINT "NotificationDelivery_lifecycle_check" CHECK (
      ("status" = 'PENDING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "cancelledAt" IS NULL) OR
      ("status" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "cancelledAt" IS NULL) OR
      ("status" = 'SUCCEEDED' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NOT NULL AND "deadLetteredAt" IS NULL AND "cancelledAt" IS NULL) OR
      ("status" = 'DEAD_LETTER' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NOT NULL AND "cancelledAt" IS NULL) OR
      ("status" = 'CANCELLED' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "cancelledAt" IS NOT NULL)
    )
);

CREATE TABLE "NotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" "NotificationAttemptOutcome" NOT NULL,
    "responseStatus" INTEGER,
    "failureCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationDeliveryAttempt_values_check" CHECK (
      "attemptNumber" > 0 AND
      "durationMs" >= 0 AND
      "completedAt" >= "startedAt" AND
      ("responseStatus" IS NULL OR "responseStatus" BETWEEN 100 AND 599)
    )
);

CREATE UNIQUE INDEX "NotificationPreference_accountId_id_key" ON "NotificationPreference"("accountId", "id");
CREATE UNIQUE INDEX "NotificationPreference_accountId_externalId_key" ON "NotificationPreference"("accountId", "externalId");
CREATE UNIQUE INDEX "NotificationPreference_accountId_membershipId_scopeKey_channel_key" ON "NotificationPreference"("accountId", "membershipId", "scopeKey", "channel");
CREATE INDEX "NotificationPreference_accountId_status_channel_idx" ON "NotificationPreference"("accountId", "status", "channel");
CREATE INDEX "NotificationPreference_accountId_teamId_status_idx" ON "NotificationPreference"("accountId", "teamId", "status");

CREATE UNIQUE INDEX "NotificationDelivery_accountId_id_key" ON "NotificationDelivery"("accountId", "id");
CREATE UNIQUE INDEX "NotificationDelivery_accountId_externalId_key" ON "NotificationDelivery"("accountId", "externalId");
CREATE UNIQUE INDEX "NotificationDelivery_preferenceId_eventId_key" ON "NotificationDelivery"("preferenceId", "eventId");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_leaseExpiresAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt", "leaseExpiresAt");
CREATE INDEX "NotificationDelivery_accountId_preferenceId_status_createdAt_idx" ON "NotificationDelivery"("accountId", "preferenceId", "status", "createdAt");
CREATE INDEX "NotificationDelivery_retentionUntil_idx" ON "NotificationDelivery"("retentionUntil");

CREATE UNIQUE INDEX "NotificationDeliveryAttempt_accountId_id_key" ON "NotificationDeliveryAttempt"("accountId", "id");
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_deliveryId_attemptNumber_key" ON "NotificationDeliveryAttempt"("deliveryId", "attemptNumber");
CREATE INDEX "NotificationDeliveryAttempt_accountId_completedAt_idx" ON "NotificationDeliveryAttempt"("accountId", "completedAt");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_membershipId_fkey" FOREIGN KEY ("accountId", "membershipId") REFERENCES "AccountMembership"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_accountId_teamId_fkey" FOREIGN KEY ("accountId", "teamId") REFERENCES "Team"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_accountId_preferenceId_fkey" FOREIGN KEY ("accountId", "preferenceId") REFERENCES "NotificationPreference"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_accountId_eventId_fkey" FOREIGN KEY ("accountId", "eventId") REFERENCES "WebhookEvent"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_accountId_deliveryId_fkey" FOREIGN KEY ("accountId", "deliveryId") REFERENCES "NotificationDelivery"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_notification_delivery_identity_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."preferenceId" IS DISTINCT FROM OLD."preferenceId"
     OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
     OR NEW."channel" IS DISTINCT FROM OLD."channel"
     OR NEW."destinationReference" IS DISTINCT FROM OLD."destinationReference"
     OR NEW."messageVersion" IS DISTINCT FROM OLD."messageVersion"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'notification delivery identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "NotificationDelivery_identity_immutable"
BEFORE UPDATE ON "NotificationDelivery"
FOR EACH ROW EXECUTE FUNCTION "reject_notification_delivery_identity_update"();

CREATE OR REPLACE FUNCTION "reject_notification_attempt_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'notification delivery attempts are append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "NotificationDeliveryAttempt_append_only"
BEFORE UPDATE OR DELETE ON "NotificationDeliveryAttempt"
FOR EACH ROW EXECUTE FUNCTION "reject_notification_attempt_mutation"();
