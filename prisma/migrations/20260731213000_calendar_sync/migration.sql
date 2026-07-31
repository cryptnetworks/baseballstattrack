CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE');
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTING', 'DISCONNECTED');
CREATE TYPE "CalendarDetailLevel" AS ENUM ('PRIVATE', 'OPPONENT', 'FULL');
CREATE TYPE "CalendarEventSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'CONFLICT', 'CANCELLED');

CREATE TABLE "CalendarConnection" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "provider" "CalendarProvider" NOT NULL,
  "providerCalendarId" TEXT NOT NULL,
  "credentialReference" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL,
  "detailLevel" "CalendarDetailLevel" NOT NULL DEFAULT 'PRIVATE',
  "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "syncLeaseOwner" TEXT,
  "syncLeaseExpiresAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarEventLink" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerVersion" TEXT,
  "sourceFingerprint" TEXT,
  "status" "CalendarEventSyncStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastFailureCode" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarConnection_externalId_key" ON "CalendarConnection"("externalId");
CREATE UNIQUE INDEX "CalendarConnection_accountId_id_key" ON "CalendarConnection"("accountId", "id");
CREATE UNIQUE INDEX "CalendarConnection_accountId_provider_providerCalendarId_key" ON "CalendarConnection"("accountId", "provider", "providerCalendarId");
CREATE INDEX "CalendarConnection_status_syncLeaseExpiresAt_idx" ON "CalendarConnection"("status", "syncLeaseExpiresAt");
CREATE INDEX "CalendarConnection_accountId_status_idx" ON "CalendarConnection"("accountId", "status");
CREATE UNIQUE INDEX "CalendarEventLink_accountId_id_key" ON "CalendarEventLink"("accountId", "id");
CREATE UNIQUE INDEX "CalendarEventLink_connectionId_gameId_key" ON "CalendarEventLink"("connectionId", "gameId");
CREATE UNIQUE INDEX "CalendarEventLink_connectionId_providerEventId_key" ON "CalendarEventLink"("connectionId", "providerEventId");
CREATE INDEX "CalendarEventLink_accountId_status_updatedAt_idx" ON "CalendarEventLink"("accountId", "status", "updatedAt");
CREATE INDEX "CalendarEventLink_accountId_gameId_idx" ON "CalendarEventLink"("accountId", "gameId");

ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_accountId_connectionId_fkey" FOREIGN KEY ("accountId", "connectionId") REFERENCES "CalendarConnection"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_accountId_gameId_fkey" FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_values_check" CHECK (
  length("providerCalendarId") BETWEEN 1 AND 512
  AND "credentialReference" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
  AND length("timeZone") BETWEEN 1 AND 128
  AND (("syncLeaseOwner" IS NULL AND "syncLeaseExpiresAt" IS NULL) OR ("syncLeaseOwner" IS NOT NULL AND "syncLeaseExpiresAt" IS NOT NULL))
  AND (("status" = 'DISCONNECTED' AND "disconnectedAt" IS NOT NULL) OR ("status" <> 'DISCONNECTED' AND "disconnectedAt" IS NULL))
);
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_values_check" CHECK (
  "providerEventId" ~ '^[a-v0-9]{5,1024}$'
  AND ("sourceFingerprint" IS NULL OR "sourceFingerprint" ~ '^[a-f0-9]{64}$')
  AND "attemptCount" >= 0
  AND (("status" = 'SYNCED' AND "lastSyncedAt" IS NOT NULL AND "lastFailureCode" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "lastFailureCode" IS NULL)
    OR ("status" IN ('FAILED', 'CONFLICT') AND "lastFailureCode" IS NOT NULL)
    OR "status" = 'PENDING')
);
