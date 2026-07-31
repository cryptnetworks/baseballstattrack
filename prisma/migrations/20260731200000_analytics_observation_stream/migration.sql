CREATE TYPE "AnalyticsObservationType" AS ENUM ('BATTED_BALL_LOCATION', 'PITCH_LOCATION');
CREATE TYPE "AnalyticsCaptureSource" AS ENUM ('MANUAL');
CREATE TYPE "AnalyticsObservationConfidence" AS ENUM ('OBSERVED', 'ESTIMATED');

CREATE TABLE "AnalyticsObservation" (
  "id" TEXT NOT NULL,
  "externalId" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "setupSnapshotId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "type" "AnalyticsObservationType" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "ordinal" INTEGER NOT NULL,
  "captureSource" "AnalyticsCaptureSource" NOT NULL,
  "confidence" "AnalyticsObservationConfidence" NOT NULL,
  "payload" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "supersedesObservationId" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsObservation_externalId_key" ON "AnalyticsObservation"("externalId");
CREATE UNIQUE INDEX "AnalyticsObservation_accountId_id_key" ON "AnalyticsObservation"("accountId", "id");
CREATE INDEX "AnalyticsObservation_accountId_gameId_sourceEventId_type_ordinal_idx"
  ON "AnalyticsObservation"("accountId", "gameId", "sourceEventId", "type", "ordinal");
CREATE INDEX "AnalyticsObservation_accountId_gameId_recordedAt_idx"
  ON "AnalyticsObservation"("accountId", "gameId", "recordedAt");
CREATE INDEX "AnalyticsObservation_accountId_supersedesObservationId_idx"
  ON "AnalyticsObservation"("accountId", "supersedesObservationId");

ALTER TABLE "AnalyticsObservation"
  ADD CONSTRAINT "AnalyticsObservation_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnalyticsObservation_accountId_gameId_fkey"
    FOREIGN KEY ("accountId", "gameId") REFERENCES "Game"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnalyticsObservation_accountId_gameId_setupSnapshotId_fkey"
    FOREIGN KEY ("accountId", "gameId", "setupSnapshotId") REFERENCES "GameSetupSnapshot"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnalyticsObservation_accountId_gameId_sourceEventId_fkey"
    FOREIGN KEY ("accountId", "gameId", "sourceEventId") REFERENCES "SourceEvent"("accountId", "gameId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnalyticsObservation_accountId_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnalyticsObservation_accountId_supersedesObservationId_fkey"
    FOREIGN KEY ("accountId", "supersedesObservationId") REFERENCES "AnalyticsObservation"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnalyticsObservation"
  ADD CONSTRAINT "AnalyticsObservation_values_check" CHECK (
    "version" = 1
    AND "ordinal" BETWEEN 0 AND 10000
    AND jsonb_typeof("payload") = 'object'
  );

CREATE OR REPLACE FUNCTION "protect_analytics_observation_evidence"() RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
    OR NEW."gameId" IS DISTINCT FROM OLD."gameId"
    OR NEW."setupSnapshotId" IS DISTINCT FROM OLD."setupSnapshotId"
    OR NEW."sourceEventId" IS DISTINCT FROM OLD."sourceEventId"
    OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."captureSource" IS DISTINCT FROM OLD."captureSource"
    OR NEW."confidence" IS DISTINCT FROM OLD."confidence"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."actorId" IS DISTINCT FROM OLD."actorId"
    OR NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId"
    OR NEW."recordedAt" IS DISTINCT FROM OLD."recordedAt" THEN
    RAISE EXCEPTION 'Analytics observation evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AnalyticsObservation_evidence_immutable"
  BEFORE UPDATE ON "AnalyticsObservation"
  FOR EACH ROW EXECUTE FUNCTION "protect_analytics_observation_evidence"();

CREATE OR REPLACE FUNCTION "enforce_analytics_observation_ordinal"() RETURNS trigger AS $$
DECLARE
  current_id TEXT;
BEGIN
  SELECT "id" INTO current_id
  FROM "AnalyticsObservation"
  WHERE "accountId" = NEW."accountId"
    AND "gameId" = NEW."gameId"
    AND "sourceEventId" = NEW."sourceEventId"
    AND "type" = NEW."type"
    AND "ordinal" = NEW."ordinal"
    AND NOT EXISTS (
      SELECT 1 FROM "AnalyticsObservation" AS newer
      WHERE newer."supersedesObservationId" = "AnalyticsObservation"."id"
    )
  LIMIT 1;
  IF current_id IS NOT NULL AND NEW."supersedesObservationId" IS DISTINCT FROM current_id THEN
    RAISE EXCEPTION 'An active analytics observation already exists for this ordinal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AnalyticsObservation_ordinal_guard"
  BEFORE INSERT ON "AnalyticsObservation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_analytics_observation_ordinal"();

CREATE OR REPLACE FUNCTION "deny_analytics_observation_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Analytics observations are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AnalyticsObservation_append_only"
  BEFORE DELETE ON "AnalyticsObservation"
  FOR EACH ROW EXECUTE FUNCTION "deny_analytics_observation_delete"();
