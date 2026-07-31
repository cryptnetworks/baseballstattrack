CREATE TYPE "RateLimitScope" AS ENUM ('ACCOUNT', 'ACTOR');
CREATE TYPE "RateLimitOverrideStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "scope" "RateLimitScope" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "endpointClass" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "limit" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RateLimitCounter_values_check" CHECK (
      "windowSeconds" > 0 AND "limit" > 0 AND "used" >= 0
    )
);

CREATE TABLE "RateLimitCharge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" TEXT NOT NULL,
    "endpointClass" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RateLimitCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RateLimitCharge_values_check" CHECK (
      "cost" > 0 AND length("operationKey") BETWEEN 1 AND 128 AND length("fingerprint") = 64
    )
);

CREATE TABLE "RateLimitOverride" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "endpointClass" TEXT NOT NULL,
    "actorKind" "ActorKind",
    "actorId" TEXT,
    "actorLimit" INTEGER NOT NULL,
    "accountLimit" INTEGER NOT NULL,
    "status" "RateLimitOverrideStatus" NOT NULL DEFAULT 'ACTIVE',
    "reasonCode" TEXT NOT NULL,
    "grantedByActorId" TEXT NOT NULL,
    "revokedByActorId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RateLimitOverride_actor_shape_check" CHECK (
      ("actorKind" IS NULL AND "actorId" IS NULL) OR
      ("actorKind" IS NOT NULL AND "actorId" IS NOT NULL)
    ),
    CONSTRAINT "RateLimitOverride_values_check" CHECK (
      "actorLimit" > 0 AND "accountLimit" > 0 AND length("reasonCode") BETWEEN 1 AND 64
    ),
    CONSTRAINT "RateLimitOverride_revoke_check" CHECK (
      ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedByActorId" IS NULL) OR
      ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedByActorId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "RateLimitCounter_window_key"
  ON "RateLimitCounter"("accountId", "scope", "actorKind", "subjectKey", "endpointClass", "policyVersion", "windowStartedAt");
CREATE INDEX "RateLimitCounter_accountId_endpointClass_windowStartedAt_idx"
  ON "RateLimitCounter"("accountId", "endpointClass", "windowStartedAt");
CREATE INDEX "RateLimitCounter_updatedAt_idx" ON "RateLimitCounter"("updatedAt");

CREATE UNIQUE INDEX "RateLimitCharge_operation_key"
  ON "RateLimitCharge"("accountId", "actorKind", "actorId", "endpointClass", "operationKey");
CREATE INDEX "RateLimitCharge_expiresAt_idx" ON "RateLimitCharge"("expiresAt");

CREATE UNIQUE INDEX "RateLimitOverride_accountId_id_key"
  ON "RateLimitOverride"("accountId", "id");
CREATE INDEX "RateLimitOverride_accountId_endpointClass_status_expiresAt_idx"
  ON "RateLimitOverride"("accountId", "endpointClass", "status", "expiresAt");
CREATE INDEX "RateLimitOverride_accountId_actorKind_actorId_endpointClass_idx"
  ON "RateLimitOverride"("accountId", "actorKind", "actorId", "endpointClass", "status", "expiresAt");

ALTER TABLE "RateLimitCounter"
  ADD CONSTRAINT "RateLimitCounter_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RateLimitCharge"
  ADD CONSTRAINT "RateLimitCharge_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RateLimitOverride"
  ADD CONSTRAINT "RateLimitOverride_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
