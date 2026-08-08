CREATE TYPE "InstallationSetupStatus" AS ENUM (
  'NOT_STARTED', 'BOOTSTRAP_IN_PROGRESS', 'ADMIN_CREATED',
  'CONFIGURATION_REQUIRED', 'READY'
);

CREATE TABLE "InstallationSetup" (
  "id" TEXT NOT NULL,
  "status" "InstallationSetupStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "accountId" TEXT,
  "bootstrapUserId" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "completedById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "InstallationSetup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstallationSetup_values_check" CHECK (
    btrim("id") <> '' AND char_length("id") <= 128 AND
    ("status" = 'READY') = ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL) AND
    ("completedAt" IS NULL) = ("completedById" IS NULL)
  )
);

CREATE INDEX "InstallationSetup_status_idx" ON "InstallationSetup"("status");
ALTER TABLE "InstallationSetup" ADD CONSTRAINT "InstallationSetup_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallationSetup" ADD CONSTRAINT "InstallationSetup_bootstrapUserId_fkey"
  FOREIGN KEY ("bootstrapUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallationSetup" ADD CONSTRAINT "InstallationSetup_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "InstallationSetup" ("id", "status", "createdAt", "updatedAt")
VALUES ('installation', 'NOT_STARTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "InstallationSetup" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role name;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'InstallationSetup', api_role);
    END IF;
  END LOOP;
END $$;
