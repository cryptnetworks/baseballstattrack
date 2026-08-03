CREATE TYPE "ConfigurationRevisionSource" AS ENUM ('ENVIRONMENT_SEED', 'ADMIN_UPDATE', 'ROLLBACK');

CREATE OR REPLACE FUNCTION "configuration_contains_secret_key"(document JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  entry RECORD;
BEGIN
  IF jsonb_typeof(document) = 'object' THEN
    FOR entry IN SELECT key, value FROM jsonb_each(document)
    LOOP
      IF entry.key ~* '(secret|token|password|api[_-]?key|private[_-]?key|signing[_-]?key)'
         OR "configuration_contains_secret_key"(entry.value) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(document) = 'array' THEN
    FOR entry IN SELECT value FROM jsonb_array_elements(document)
    LOOP
      IF "configuration_contains_secret_key"(entry.value) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public;

CREATE TABLE "ApplicationConfiguration" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "currentRevision" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicationConfiguration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ApplicationConfiguration_values_check" CHECK (
      "schemaVersion" > 0 AND
      "currentRevision" > 0 AND
      "digest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      jsonb_typeof("values") = 'object' AND
      NOT "configuration_contains_secret_key"("values")
    )
);

CREATE TABLE "ApplicationConfigurationRevision" (
    "id" TEXT NOT NULL,
    "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "source" "ConfigurationRevisionSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "previousRevisionId" TEXT,
    "rolledBackFromRevision" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationConfigurationRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ApplicationConfigurationRevision_values_check" CHECK (
      "revision" > 0 AND
      "schemaVersion" > 0 AND
      ("revision" = 1) = ("previousRevisionId" IS NULL) AND
      ("source" = 'ENVIRONMENT_SEED') = ("revision" = 1) AND
      ("source" = 'ROLLBACK') = ("rolledBackFromRevision" IS NOT NULL) AND
      ("rolledBackFromRevision" IS NULL OR "rolledBackFromRevision" < "revision") AND
      btrim("reason") <> '' AND
      char_length("reason") <= 240 AND
      btrim("actorId") <> '' AND
      char_length("actorId") <= 128 AND
      "digest" ~ '^sha256:v1:[a-f0-9]{64}$' AND
      jsonb_typeof("values") = 'object' AND
      NOT "configuration_contains_secret_key"("values")
    )
);

CREATE UNIQUE INDEX "ApplicationConfiguration_externalId_key" ON "ApplicationConfiguration"("externalId");
CREATE UNIQUE INDEX "ApplicationConfiguration_accountId_key" ON "ApplicationConfiguration"("accountId");
CREATE UNIQUE INDEX "ApplicationConfiguration_accountId_id_key" ON "ApplicationConfiguration"("accountId", "id");
CREATE INDEX "ApplicationConfiguration_accountId_updatedAt_idx" ON "ApplicationConfiguration"("accountId", "updatedAt");

CREATE UNIQUE INDEX "ApplicationConfigurationRevision_externalId_key" ON "ApplicationConfigurationRevision"("externalId");
CREATE UNIQUE INDEX "AppConfigRevision_account_config_id_key" ON "ApplicationConfigurationRevision"("accountId", "configurationId", "id");
CREATE UNIQUE INDEX "ApplicationConfigurationRevision_configurationId_revision_key" ON "ApplicationConfigurationRevision"("configurationId", "revision");
CREATE INDEX "AppConfigRevision_account_config_created_idx" ON "ApplicationConfigurationRevision"("accountId", "configurationId", "createdAt");
CREATE INDEX "ApplicationConfigurationRevision_actorUserId_createdAt_idx" ON "ApplicationConfigurationRevision"("actorUserId", "createdAt");

ALTER TABLE "ApplicationConfiguration" ADD CONSTRAINT "ApplicationConfiguration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationConfiguration" ADD CONSTRAINT "ApplicationConfiguration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationConfiguration" ADD CONSTRAINT "ApplicationConfiguration_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApplicationConfigurationRevision" ADD CONSTRAINT "ApplicationConfigurationRevision_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationConfigurationRevision" ADD CONSTRAINT "ApplicationConfigurationRevision_accountId_configurationId_fkey" FOREIGN KEY ("accountId", "configurationId") REFERENCES "ApplicationConfiguration"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationConfigurationRevision" ADD CONSTRAINT "ApplicationConfigurationRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplicationConfigurationRevision" ADD CONSTRAINT "ApplicationConfigurationRevision_lineage_fkey" FOREIGN KEY ("accountId", "configurationId", "previousRevisionId") REFERENCES "ApplicationConfigurationRevision"("accountId", "configurationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "protect_application_configuration_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."externalId" IS DISTINCT FROM OLD."externalId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'application configuration identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."currentRevision" <> OLD."currentRevision" + 1 THEN
    RAISE EXCEPTION 'application configuration revision must advance exactly once' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."ApplicationConfigurationRevision" AS revision
    WHERE revision."accountId" = NEW."accountId"
      AND revision."configurationId" = NEW."id"
      AND revision."revision" = NEW."currentRevision"
      AND revision."schemaVersion" = NEW."schemaVersion"
      AND revision."digest" = NEW."digest"
      AND revision."values" = NEW."values"
      AND revision."actorUserId" = NEW."updatedById"
  ) THEN
    RAISE EXCEPTION 'application configuration head must match its immutable revision' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "validate_application_configuration_head"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."ApplicationConfigurationRevision" AS revision
    WHERE revision."accountId" = NEW."accountId"
      AND revision."configurationId" = NEW."id"
      AND revision."revision" = NEW."currentRevision"
      AND revision."schemaVersion" = NEW."schemaVersion"
      AND revision."digest" = NEW."digest"
      AND revision."values" = NEW."values"
      AND revision."actorUserId" = NEW."updatedById"
      AND (NEW."currentRevision" > 1 OR revision."actorUserId" = NEW."createdById")
  ) THEN
    RAISE EXCEPTION 'application configuration must commit with matching immutable history' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "validate_application_configuration_revision"()
RETURNS trigger AS $$
DECLARE
  predecessor_revision INTEGER;
BEGIN
  IF NEW."revision" > 1 THEN
    SELECT revision."revision"
      INTO predecessor_revision
      FROM public."ApplicationConfigurationRevision" AS revision
      WHERE revision."accountId" = NEW."accountId"
        AND revision."configurationId" = NEW."configurationId"
        AND revision."id" = NEW."previousRevisionId";
    IF predecessor_revision IS DISTINCT FROM NEW."revision" - 1 THEN
      RAISE EXCEPTION 'application configuration revision lineage must be contiguous' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW."rolledBackFromRevision" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public."ApplicationConfigurationRevision" AS revision
    WHERE revision."accountId" = NEW."accountId"
      AND revision."configurationId" = NEW."configurationId"
      AND revision."revision" = NEW."rolledBackFromRevision"
  ) THEN
    RAISE EXCEPTION 'application configuration rollback target must exist' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION "prevent_application_configuration_history_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'application configuration history is append-only' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER "ApplicationConfiguration_identity_immutable"
BEFORE UPDATE ON "ApplicationConfiguration"
FOR EACH ROW EXECUTE FUNCTION "protect_application_configuration_identity"();

CREATE TRIGGER "ApplicationConfigurationRevision_append_only"
BEFORE UPDATE OR DELETE ON "ApplicationConfigurationRevision"
FOR EACH ROW EXECUTE FUNCTION "prevent_application_configuration_history_mutation"();

CREATE TRIGGER "ApplicationConfigurationRevision_lineage_guard"
BEFORE INSERT ON "ApplicationConfigurationRevision"
FOR EACH ROW EXECUTE FUNCTION "validate_application_configuration_revision"();

CREATE CONSTRAINT TRIGGER "ApplicationConfiguration_history_required"
AFTER INSERT OR UPDATE ON "ApplicationConfiguration"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_application_configuration_head"();

REVOKE ALL ON FUNCTION "configuration_contains_secret_key"(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_application_configuration_identity"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_application_configuration_revision"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_application_configuration_head"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "prevent_application_configuration_history_mutation"() FROM PUBLIC;

ALTER TABLE "ApplicationConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApplicationConfigurationRevision" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role name;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'ApplicationConfiguration', api_role);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'ApplicationConfigurationRevision', api_role);
    END IF;
  END LOOP;
END
$$;
