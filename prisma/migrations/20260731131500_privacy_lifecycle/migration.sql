CREATE TYPE "DataExportArtifactStatus" AS ENUM ('AVAILABLE', 'DOWNLOADED', 'CANCELLED', 'EXPIRED', 'REVOKED');
CREATE TYPE "PrivacyLifecycleTarget" AS ENUM ('ACCOUNT', 'USER', 'PLAYER');
CREATE TYPE "PrivacyLifecycleStatus" AS ENUM ('REQUESTED', 'BLOCKED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "PrivacyHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "DataExportArtifact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "requestedByActorId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "status" "DataExportArtifactStatus" NOT NULL DEFAULT 'AVAILABLE',
    "tokenVerifier" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "downloadedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataExportArtifact_token_state_check" CHECK (
      ("status" = 'AVAILABLE' AND "tokenVerifier" IS NOT NULL) OR
      ("status" <> 'AVAILABLE' AND "tokenVerifier" IS NULL)
    ),
    CONSTRAINT "DataExportArtifact_terminal_time_check" CHECK (
      ("status" = 'DOWNLOADED') = ("downloadedAt" IS NOT NULL) AND
      ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL) AND
      ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)
    )
);

CREATE TABLE "PrivacyLifecycleRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "target" "PrivacyLifecycleTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "requestedByActorId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "status" "PrivacyLifecycleStatus" NOT NULL DEFAULT 'REQUESTED',
    "reasonCode" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "blockedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyLifecycleRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivacyLifecycleRequest_account_target_check" CHECK (
      "target" <> 'ACCOUNT' OR "targetId" = "accountId"
    ),
    CONSTRAINT "PrivacyLifecycleRequest_terminal_time_check" CHECK (
      ("status" = 'BLOCKED') = ("blockedAt" IS NOT NULL) AND
      ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL) AND
      ("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)
    )
);

CREATE TABLE "PrivacyHold" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lifecycleRequestId" TEXT,
    "status" "PrivacyHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "reasonCode" TEXT NOT NULL,
    "requestedByActorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyHold_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivacyHold_release_check" CHECK (
      ("status" = 'RELEASED') = ("releasedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "DataExportArtifact_accountId_requestedByActorId_clientRequest_key"
  ON "DataExportArtifact"("accountId", "requestedByActorId", "clientRequestId");
CREATE UNIQUE INDEX "DataExportArtifact_accountId_id_key"
  ON "DataExportArtifact"("accountId", "id");
CREATE INDEX "DataExportArtifact_accountId_status_expiresAt_idx"
  ON "DataExportArtifact"("accountId", "status", "expiresAt");

CREATE UNIQUE INDEX "PrivacyLifecycleRequest_accountId_requestedByActorId_clientR_key"
  ON "PrivacyLifecycleRequest"("accountId", "requestedByActorId", "clientRequestId");
CREATE UNIQUE INDEX "PrivacyLifecycleRequest_accountId_id_key"
  ON "PrivacyLifecycleRequest"("accountId", "id");
CREATE INDEX "PrivacyLifecycleRequest_accountId_target_targetId_status_idx"
  ON "PrivacyLifecycleRequest"("accountId", "target", "targetId", "status");
CREATE INDEX "PrivacyLifecycleRequest_status_scheduledFor_idx"
  ON "PrivacyLifecycleRequest"("status", "scheduledFor");
CREATE UNIQUE INDEX "PrivacyLifecycleRequest_active_target_key"
  ON "PrivacyLifecycleRequest"("accountId", "target", "targetId")
  WHERE "status" IN ('REQUESTED', 'BLOCKED');

CREATE UNIQUE INDEX "PrivacyHold_accountId_id_key"
  ON "PrivacyHold"("accountId", "id");
CREATE INDEX "PrivacyHold_accountId_status_expiresAt_idx"
  ON "PrivacyHold"("accountId", "status", "expiresAt");
CREATE INDEX "PrivacyHold_accountId_lifecycleRequestId_status_idx"
  ON "PrivacyHold"("accountId", "lifecycleRequestId", "status");

ALTER TABLE "DataExportArtifact"
  ADD CONSTRAINT "DataExportArtifact_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrivacyLifecycleRequest"
  ADD CONSTRAINT "PrivacyLifecycleRequest_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrivacyHold"
  ADD CONSTRAINT "PrivacyHold_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrivacyHold"
  ADD CONSTRAINT "PrivacyHold_accountId_lifecycleRequestId_fkey"
  FOREIGN KEY ("accountId", "lifecycleRequestId")
  REFERENCES "PrivacyLifecycleRequest"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
