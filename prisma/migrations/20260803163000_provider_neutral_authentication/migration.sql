CREATE TYPE "AuthenticationIdentitySource" AS ENUM ('LEGACY_BACKFILL', 'OAUTH_SIGN_IN', 'EXPLICIT_LINK', 'REVIEWED_MIGRATION');
CREATE TYPE "AuthenticationSessionEventType" AS ENUM ('CREATED', 'ROTATED', 'REVOKED', 'EXPIRED');
CREATE TYPE "OAuthAttemptPurpose" AS ENUM ('SIGN_IN', 'LINK');

CREATE TABLE "AuthenticationIdentity" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN,
    "source" "AuthenticationIdentitySource" NOT NULL,
    "linkedByAppUserId" TEXT,
    "linkedReason" TEXT,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAuthenticatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthenticationIdentity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthenticationIdentity_values_check" CHECK (
      btrim("provider") <> '' AND char_length("provider") <= 64 AND
      btrim("providerSubject") <> '' AND char_length("providerSubject") <= 1024 AND
      ("email" IS NULL OR (char_length("email") <= 320 AND btrim("email") = "email")) AND
      ("linkedReason" IS NULL OR (btrim("linkedReason") <> '' AND char_length("linkedReason") <= 240))
    )
);

CREATE TABLE "AuthenticationSession" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appUserId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "previousTokenHash" TEXT,
    "previousTokenValidUntil" TIMESTAMPTZ(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revocationReason" TEXT,

    CONSTRAINT "AuthenticationSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthenticationSession_values_check" CHECK (
      "tokenVersion" > 0 AND
      "tokenHash" ~ '^hmac-sha256:v1:[a-f0-9]{64}$' AND
      ("previousTokenHash" IS NULL) = ("previousTokenValidUntil" IS NULL) AND
      ("previousTokenHash" IS NULL OR "previousTokenHash" ~ '^hmac-sha256:v1:[a-f0-9]{64}$') AND
      "idleExpiresAt" <= "absoluteExpiresAt" AND
      "lastSeenAt" >= "createdAt" AND
      "rotatedAt" >= "createdAt" AND
      ("revokedAt" IS NULL) = ("revocationReason" IS NULL) AND
      ("revocationReason" IS NULL OR (btrim("revocationReason") <> '' AND char_length("revocationReason") <= 64))
    )
);

CREATE TABLE "AuthenticationSessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" "AuthenticationSessionEventType" NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "reasonCode" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationSessionEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthenticationSessionEvent_values_check" CHECK (
      "tokenVersion" > 0 AND
      ("reasonCode" IS NULL OR (btrim("reasonCode") <> '' AND char_length("reasonCode") <= 64))
    )
);

CREATE TABLE "OAuthLoginAttempt" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "purpose" "OAuthAttemptPurpose" NOT NULL,
    "appUserId" TEXT,
    "initiatingSessionId" TEXT,
    "stateHash" TEXT NOT NULL,
    "browserBindingHash" TEXT NOT NULL,
    "encryptedSecrets" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthLoginAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OAuthLoginAttempt_values_check" CHECK (
      btrim("provider") <> '' AND char_length("provider") <= 64 AND
      "stateHash" ~ '^hmac-sha256:v1:[a-f0-9]{64}$' AND
      "browserBindingHash" ~ '^hmac-sha256:v1:[a-f0-9]{64}$' AND
      "encryptedSecrets" ~ '^aes-256-gcm:v1:[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$' AND
      "returnTo" ~ '^/(?!/)[A-Za-z0-9/_?=&.-]*$' AND
      "expiresAt" > "createdAt" AND
      ("purpose" = 'LINK') = ("appUserId" IS NOT NULL) AND
      ("purpose" = 'LINK') = ("initiatingSessionId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "AuthenticationIdentity_externalId_key" ON "AuthenticationIdentity"("externalId");
CREATE UNIQUE INDEX "AuthenticationIdentity_provider_providerSubject_key" ON "AuthenticationIdentity"("provider", "providerSubject");
CREATE UNIQUE INDEX "AuthenticationIdentity_appUserId_id_key" ON "AuthenticationIdentity"("appUserId", "id");
CREATE INDEX "AuthenticationIdentity_appUserId_linkedAt_idx" ON "AuthenticationIdentity"("appUserId", "linkedAt");

CREATE UNIQUE INDEX "AuthenticationSession_externalId_key" ON "AuthenticationSession"("externalId");
CREATE UNIQUE INDEX "AuthenticationSession_appUserId_id_key" ON "AuthenticationSession"("appUserId", "id");
CREATE INDEX "AuthenticationSession_appUserId_revokedAt_absoluteExpiresAt_idx" ON "AuthenticationSession"("appUserId", "revokedAt", "absoluteExpiresAt");
CREATE INDEX "AuthenticationSession_idleExpiresAt_idx" ON "AuthenticationSession"("idleExpiresAt");

CREATE INDEX "AuthenticationSessionEvent_sessionId_occurredAt_idx" ON "AuthenticationSessionEvent"("sessionId", "occurredAt");

CREATE UNIQUE INDEX "OAuthLoginAttempt_externalId_key" ON "OAuthLoginAttempt"("externalId");
CREATE UNIQUE INDEX "OAuthLoginAttempt_stateHash_key" ON "OAuthLoginAttempt"("stateHash");
CREATE INDEX "OAuthLoginAttempt_expiresAt_consumedAt_idx" ON "OAuthLoginAttempt"("expiresAt", "consumedAt");
CREATE INDEX "OAuthLoginAttempt_appUserId_createdAt_idx" ON "OAuthLoginAttempt"("appUserId", "createdAt");
CREATE INDEX "OAuthLoginAttempt_appUserId_initiatingSessionId_idx" ON "OAuthLoginAttempt"("appUserId", "initiatingSessionId");

ALTER TABLE "AuthenticationIdentity" ADD CONSTRAINT "AuthenticationIdentity_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthenticationIdentity" ADD CONSTRAINT "AuthenticationIdentity_linkedByAppUserId_fkey" FOREIGN KEY ("linkedByAppUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthenticationSession" ADD CONSTRAINT "AuthenticationSession_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthenticationSession" ADD CONSTRAINT "AuthenticationSession_appUserId_identityId_fkey" FOREIGN KEY ("appUserId", "identityId") REFERENCES "AuthenticationIdentity"("appUserId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthenticationSessionEvent" ADD CONSTRAINT "AuthenticationSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthenticationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OAuthLoginAttempt" ADD CONSTRAINT "OAuthLoginAttempt_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OAuthLoginAttempt" ADD CONSTRAINT "OAuthLoginAttempt_appUserId_initiatingSessionId_fkey" FOREIGN KEY ("appUserId", "initiatingSessionId") REFERENCES "AuthenticationSession"("appUserId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "AuthenticationIdentity" (
  "id", "appUserId", "provider", "providerSubject", "source",
  "linkedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, "id", "provider", "providerSubject",
  'LEGACY_BACKFILL'::"AuthenticationIdentitySource", "createdAt", "createdAt", CURRENT_TIMESTAMP
FROM "AppUser";

CREATE OR REPLACE FUNCTION "protect_authentication_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."appUserId" IS DISTINCT FROM OLD."appUserId"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."providerSubject" IS DISTINCT FROM OLD."providerSubject"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."linkedByAppUserId" IS DISTINCT FROM OLD."linkedByAppUserId"
     OR NEW."linkedReason" IS DISTINCT FROM OLD."linkedReason"
     OR NEW."linkedAt" IS DISTINCT FROM OLD."linkedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'authentication identity ownership and provider subject are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "protect_authentication_session_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."appUserId" IS DISTINCT FROM OLD."appUserId"
     OR NEW."identityId" IS DISTINCT FROM OLD."identityId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'authentication session identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "prevent_authentication_session_event_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'authentication session history is append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "protect_oauth_login_attempt"()
RETURNS trigger AS $$
BEGIN
  IF NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
     OR NEW."appUserId" IS DISTINCT FROM OLD."appUserId"
     OR NEW."initiatingSessionId" IS DISTINCT FROM OLD."initiatingSessionId"
     OR NEW."stateHash" IS DISTINCT FROM OLD."stateHash"
     OR NEW."browserBindingHash" IS DISTINCT FROM OLD."browserBindingHash"
     OR NEW."encryptedSecrets" IS DISTINCT FROM OLD."encryptedSecrets"
     OR NEW."redirectUri" IS DISTINCT FROM OLD."redirectUri"
     OR NEW."returnTo" IS DISTINCT FROM OLD."returnTo"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR OLD."consumedAt" IS NOT NULL
     OR NEW."consumedAt" IS NULL THEN
    RAISE EXCEPTION 'OAuth login attempt is immutable except for one-time consumption' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER "AuthenticationIdentity_identity_immutable"
BEFORE UPDATE ON "AuthenticationIdentity"
FOR EACH ROW EXECUTE FUNCTION "protect_authentication_identity"();

CREATE TRIGGER "AuthenticationSession_identity_immutable"
BEFORE UPDATE ON "AuthenticationSession"
FOR EACH ROW EXECUTE FUNCTION "protect_authentication_session_identity"();

CREATE TRIGGER "AuthenticationSessionEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuthenticationSessionEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_authentication_session_event_mutation"();

CREATE TRIGGER "OAuthLoginAttempt_one_time_consumption"
BEFORE UPDATE ON "OAuthLoginAttempt"
FOR EACH ROW EXECUTE FUNCTION "protect_oauth_login_attempt"();

REVOKE ALL ON FUNCTION "protect_authentication_identity"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_authentication_session_identity"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "prevent_authentication_session_event_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_oauth_login_attempt"() FROM PUBLIC;

ALTER TABLE "AuthenticationIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthenticationSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthenticationSessionEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OAuthLoginAttempt" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role name;
  table_name name;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH table_name IN ARRAY ARRAY['AuthenticationIdentity', 'AuthenticationSession', 'AuthenticationSessionEvent', 'OAuthLoginAttempt']
      LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, api_role);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
