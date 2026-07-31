CREATE TYPE "ExternalDataSourceStatus" AS ENUM ('DISABLED', 'ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "ExternalIngestionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ExternalProviderRecordStatus" AS ENUM ('PUBLISHED', 'QUARANTINED', 'SUPERSEDED');
CREATE TYPE "ExternalQuarantineStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

CREATE TABLE "ExternalDataSource" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "status" "ExternalDataSourceStatus" NOT NULL DEFAULT 'DISABLED',
  "approvalReference" TEXT,
  "termsVersion" TEXT,
  "attribution" TEXT,
  "cadenceSeconds" INTEGER NOT NULL,
  "backfillDays" INTEGER NOT NULL,
  "checkpoint" JSONB,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "quotaRemaining" INTEGER,
  "quotaResetAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalDataSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIngestionRun" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" "ExternalIngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "windowEndedAt" TIMESTAMP(3) NOT NULL,
  "checkpointBefore" JSONB,
  "checkpointAfter" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "pageCount" INTEGER NOT NULL DEFAULT 0,
  "recordCount" INTEGER NOT NULL DEFAULT 0,
  "publishedCount" INTEGER NOT NULL DEFAULT 0,
  "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ExternalIngestionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalProviderRecord" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "providerRecordId" TEXT NOT NULL,
  "providerVersion" TEXT NOT NULL,
  "payloadVersion" INTEGER NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "status" "ExternalProviderRecordStatus" NOT NULL,
  "canonicalType" TEXT,
  "canonicalExternalId" UUID,
  "correctionOfId" TEXT,
  "retrievedAt" TIMESTAMP(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalProviderRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIngestionQuarantine" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "status" "ExternalQuarantineStatus" NOT NULL DEFAULT 'OPEN',
  "diagnosticCodes" TEXT[],
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIngestionQuarantine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalDataSource_externalId_key" ON "ExternalDataSource"("externalId");
CREATE UNIQUE INDEX "ExternalDataSource_accountId_id_key" ON "ExternalDataSource"("accountId", "id");
CREATE UNIQUE INDEX "ExternalDataSource_accountId_externalId_key" ON "ExternalDataSource"("accountId", "externalId");
CREATE UNIQUE INDEX "ExternalDataSource_accountId_providerKey_key" ON "ExternalDataSource"("accountId", "providerKey");
CREATE INDEX "ExternalDataSource_status_lastSuccessAt_idx" ON "ExternalDataSource"("status", "lastSuccessAt");
CREATE UNIQUE INDEX "ExternalIngestionRun_accountId_id_key" ON "ExternalIngestionRun"("accountId", "id");
CREATE UNIQUE INDEX "ExternalIngestionRun_sourceId_runKey_key" ON "ExternalIngestionRun"("sourceId", "runKey");
CREATE INDEX "ExternalIngestionRun_sourceId_status_startedAt_idx" ON "ExternalIngestionRun"("sourceId", "status", "startedAt");
CREATE UNIQUE INDEX "ExternalProviderRecord_externalId_key" ON "ExternalProviderRecord"("externalId");
CREATE UNIQUE INDEX "ExternalProviderRecord_accountId_id_key" ON "ExternalProviderRecord"("accountId", "id");
CREATE UNIQUE INDEX "ExternalProviderRecord_sourceId_recordType_providerRecordId_providerVersion_key" ON "ExternalProviderRecord"("sourceId", "recordType", "providerRecordId", "providerVersion");
CREATE INDEX "ExternalProviderRecord_accountId_recordType_status_effectiveAt_idx" ON "ExternalProviderRecord"("accountId", "recordType", "status", "effectiveAt");
CREATE INDEX "ExternalProviderRecord_sourceId_providerRecordId_retrievedAt_idx" ON "ExternalProviderRecord"("sourceId", "providerRecordId", "retrievedAt");
CREATE UNIQUE INDEX "ExternalIngestionQuarantine_recordId_key" ON "ExternalIngestionQuarantine"("recordId");
CREATE UNIQUE INDEX "ExternalIngestionQuarantine_accountId_id_key" ON "ExternalIngestionQuarantine"("accountId", "id");
CREATE UNIQUE INDEX "ExternalIngestionQuarantine_accountId_recordId_key" ON "ExternalIngestionQuarantine"("accountId", "recordId");
CREATE INDEX "ExternalIngestionQuarantine_accountId_status_createdAt_idx" ON "ExternalIngestionQuarantine"("accountId", "status", "createdAt");

ALTER TABLE "ExternalDataSource" ADD CONSTRAINT "ExternalDataSource_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIngestionRun" ADD CONSTRAINT "ExternalIngestionRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIngestionRun" ADD CONSTRAINT "ExternalIngestionRun_accountId_sourceId_fkey" FOREIGN KEY ("accountId", "sourceId") REFERENCES "ExternalDataSource"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderRecord" ADD CONSTRAINT "ExternalProviderRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderRecord" ADD CONSTRAINT "ExternalProviderRecord_accountId_sourceId_fkey" FOREIGN KEY ("accountId", "sourceId") REFERENCES "ExternalDataSource"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderRecord" ADD CONSTRAINT "ExternalProviderRecord_accountId_runId_fkey" FOREIGN KEY ("accountId", "runId") REFERENCES "ExternalIngestionRun"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderRecord" ADD CONSTRAINT "ExternalProviderRecord_accountId_correctionOfId_fkey" FOREIGN KEY ("accountId", "correctionOfId") REFERENCES "ExternalProviderRecord"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIngestionQuarantine" ADD CONSTRAINT "ExternalIngestionQuarantine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIngestionQuarantine" ADD CONSTRAINT "ExternalIngestionQuarantine_accountId_sourceId_fkey" FOREIGN KEY ("accountId", "sourceId") REFERENCES "ExternalDataSource"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIngestionQuarantine" ADD CONSTRAINT "ExternalIngestionQuarantine_accountId_recordId_fkey" FOREIGN KEY ("accountId", "recordId") REFERENCES "ExternalProviderRecord"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalDataSource" ADD CONSTRAINT "ExternalDataSource_values_check" CHECK (
  "cadenceSeconds" BETWEEN 60 AND 604800 AND "backfillDays" BETWEEN 0 AND 3660
  AND "consecutiveFailures" >= 0 AND ("quotaRemaining" IS NULL OR "quotaRemaining" >= 0)
), ADD CONSTRAINT "ExternalDataSource_approval_check" CHECK (
  "status" <> 'ACTIVE' OR (
    "approvalReference" ~ '^APPROVED:[A-Z0-9][A-Z0-9._:-]{7,127}$'
    AND length("termsVersion") BETWEEN 1 AND 128
    AND length("attribution") BETWEEN 1 AND 512
  )
);
ALTER TABLE "ExternalIngestionRun" ADD CONSTRAINT "ExternalIngestionRun_values_check" CHECK (
  "mode" IN ('SCHEDULED', 'BACKFILL') AND "windowEndedAt" > "windowStartedAt"
  AND "attemptCount" > 0 AND "pageCount" >= 0 AND "recordCount" >= 0
  AND "publishedCount" >= 0 AND "quarantinedCount" >= 0
), ADD CONSTRAINT "ExternalIngestionRun_lifecycle_check" CHECK (
  ("status" = 'RUNNING' AND "completedAt" IS NULL AND "failureCode" IS NULL)
  OR ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "failureCode" IS NULL AND "checkpointAfter" IS NOT NULL)
  OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
);
ALTER TABLE "ExternalProviderRecord" ADD CONSTRAINT "ExternalProviderRecord_values_check" CHECK (
  "payloadVersion" = 1 AND "payloadDigest" ~ '^[a-f0-9]{64}$'
  AND (("canonicalType" IS NULL AND "canonicalExternalId" IS NULL) OR ("canonicalType" IS NOT NULL AND "canonicalExternalId" IS NOT NULL))
);
ALTER TABLE "ExternalIngestionQuarantine" ADD CONSTRAINT "ExternalIngestionQuarantine_lifecycle_check" CHECK (
  cardinality("diagnosticCodes") > 0 AND (
    ("status" = 'OPEN' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL)
    OR ("status" IN ('RESOLVED', 'DISMISSED') AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION "protect_external_record_evidence"() RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
    OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
    OR NEW."runId" IS DISTINCT FROM OLD."runId"
    OR NEW."recordType" IS DISTINCT FROM OLD."recordType"
    OR NEW."providerRecordId" IS DISTINCT FROM OLD."providerRecordId"
    OR NEW."providerVersion" IS DISTINCT FROM OLD."providerVersion"
    OR NEW."payloadDigest" IS DISTINCT FROM OLD."payloadDigest"
    OR NEW."normalizedPayload" IS DISTINCT FROM OLD."normalizedPayload"
    OR NEW."retrievedAt" IS DISTINCT FROM OLD."retrievedAt" THEN
    RAISE EXCEPTION 'External provider evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ExternalProviderRecord_evidence_immutable" BEFORE UPDATE ON "ExternalProviderRecord" FOR EACH ROW EXECUTE FUNCTION "protect_external_record_evidence"();
