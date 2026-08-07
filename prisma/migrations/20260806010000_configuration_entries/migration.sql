CREATE TYPE "ConfigurationCategory" AS ENUM (
  'FEATURES', 'CALENDAR', 'NOTIFICATIONS', 'INTEGRATIONS',
  'RATE_LIMITS', 'AUTHENTICATION', 'DISCORD', 'EXTERNAL_API'
);
CREATE TYPE "ConfigurationScope" AS ENUM ('GLOBAL', 'ACCOUNT');
CREATE TYPE "ConfigurationVisibility" AS ENUM ('ADMIN', 'INTERNAL', 'PUBLIC');
CREATE TYPE "SecretReferenceProvider" AS ENUM (
  'AWS_SECRETS_MANAGER', 'VAULT', 'DOCKER_SECRET', 'KUBERNETES_SECRET', 'ENVIRONMENT'
);

CREATE TABLE "SecretReference" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "SecretReferenceProvider" NOT NULL,
  "referenceIdentifier" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "rotationMetadata" JSONB,
  "lastRotatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SecretReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecretReference_values_check" CHECK (
    btrim("referenceIdentifier") <> '' AND char_length("referenceIdentifier") <= 512 AND
    btrim("environment") <> '' AND char_length("environment") <= 128 AND
    ("rotationMetadata" IS NULL OR NOT "configuration_contains_secret_key"("rotationMetadata"))
  )
);

CREATE TABLE "ConfigurationEntry" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "category" "ConfigurationCategory" NOT NULL,
  "scope" "ConfigurationScope" NOT NULL,
  "accountId" TEXT,
  "ownerId" TEXT,
  "visibility" "ConfigurationVisibility" NOT NULL DEFAULT 'ADMIN',
  "value" JSONB,
  "secretReferenceId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConfigurationEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConfigurationEntry_values_check" CHECK (
    btrim("key") <> '' AND char_length("key") <= 160 AND
    (("scope" = 'GLOBAL' AND "accountId" IS NULL) OR
     ("scope" = 'ACCOUNT' AND "accountId" IS NOT NULL)) AND
    (("value" IS NOT NULL) <> ("secretReferenceId" IS NOT NULL)) AND
    ("value" IS NULL OR (jsonb_typeof("value") IN ('object', 'array', 'string', 'number', 'boolean') AND
      NOT "configuration_contains_secret_key"("value"))) AND
    ("key" !~* '(secret|token|password|api[_-]?key|private[_-]?key|signing[_-]?key)' OR
      "secretReferenceId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "SecretReference_externalId_key" ON "SecretReference"("externalId");
CREATE UNIQUE INDEX "SecretReference_provider_referenceIdentifier_environment_key"
  ON "SecretReference"("provider", "referenceIdentifier", "environment");
CREATE INDEX "SecretReference_environment_updatedAt_idx" ON "SecretReference"("environment", "updatedAt");
CREATE UNIQUE INDEX "ConfigurationEntry_externalId_key" ON "ConfigurationEntry"("externalId");
CREATE UNIQUE INDEX "ConfigurationEntry_scope_accountId_key_key" ON "ConfigurationEntry"("scope", "accountId", "key");
CREATE INDEX "ConfigurationEntry_category_scope_visibility_idx" ON "ConfigurationEntry"("category", "scope", "visibility");
CREATE INDEX "ConfigurationEntry_accountId_category_updatedAt_idx" ON "ConfigurationEntry"("accountId", "category", "updatedAt");

ALTER TABLE "ConfigurationEntry" ADD CONSTRAINT "ConfigurationEntry_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationEntry" ADD CONSTRAINT "ConfigurationEntry_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationEntry" ADD CONSTRAINT "ConfigurationEntry_secretReferenceId_fkey"
  FOREIGN KEY ("secretReferenceId") REFERENCES "SecretReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SecretReference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConfigurationEntry" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role name;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'SecretReference', api_role);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'ConfigurationEntry', api_role);
    END IF;
  END LOOP;
END $$;
