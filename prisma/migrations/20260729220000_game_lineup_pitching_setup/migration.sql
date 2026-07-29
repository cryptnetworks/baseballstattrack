-- Issue #14 makes the latest ready setup explicit without changing the
-- source-event revision used by deterministic replay.
CREATE TYPE "WeatherCondition" AS ENUM (
  'CLEAR',
  'PARTLY_CLOUDY',
  'CLOUDY',
  'LIGHT_RAIN',
  'RAIN',
  'WINDY',
  'INDOOR'
);

ALTER TABLE "Game"
  ADD COLUMN "setupRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readySetupSnapshotId" TEXT,
  ADD COLUMN "weatherCondition" "WeatherCondition",
  ADD COLUMN "temperatureF" INTEGER;

ALTER TABLE "GameSetupSnapshot"
  ADD COLUMN "weatherCondition" "WeatherCondition",
  ADD COLUMN "temperatureF" INTEGER,
  ADD COLUMN "createdByActorId" TEXT,
  ADD COLUMN "clientSubmissionId" TEXT,
  ADD COLUMN "payloadHash" TEXT;

UPDATE "Game" AS game
SET "setupRevision" = latest."setupRevision"
FROM (
  SELECT "gameId", MAX("setupRevision") AS "setupRevision"
  FROM "GameSetupSnapshot"
  GROUP BY "gameId"
) AS latest
WHERE latest."gameId" = game."id";

UPDATE "Game" AS game
SET "readySetupSnapshotId" = snapshot."id"
FROM "GameSetupSnapshot" AS snapshot
WHERE snapshot."gameId" = game."id"
  AND snapshot."setupRevision" = game."setupRevision"
  AND game."status" IN (
    'READY',
    'IN_PROGRESS',
    'SUSPENDED',
    'COMPLETED',
    'VERIFIED',
    'CORRECTED'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Game"
    WHERE "status" IN (
      'READY',
      'IN_PROGRESS',
      'SUSPENDED',
      'COMPLETED',
      'VERIFIED',
      'CORRECTED'
    )
      AND "readySetupSnapshotId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'operational game is missing an attributable setup snapshot';
  END IF;
END;
$$;

ALTER TABLE "Game" ADD CONSTRAINT "Game_setup_state_check"
  CHECK (
    "setupRevision" >= 0
    AND ("temperatureF" IS NULL OR "temperatureF" BETWEEN -20 AND 130)
    AND (
      "status" NOT IN (
        'READY',
        'IN_PROGRESS',
        'SUSPENDED',
        'COMPLETED',
        'VERIFIED',
        'CORRECTED'
      )
      OR "readySetupSnapshotId" IS NOT NULL
    )
    AND ("status" <> 'DRAFT' OR "readySetupSnapshotId" IS NULL)
  );

ALTER TABLE "GameSetupSnapshot"
  ADD CONSTRAINT "GameSetupSnapshot_management_shape_check"
  CHECK (
    "setupRevision" >= 1
    AND ("temperatureF" IS NULL OR "temperatureF" BETWEEN -20 AND 130)
    AND ("payloadHash" IS NULL OR "payloadHash" ~ '^[0-9a-f]{64}$')
    AND (
      ("createdByActorId" IS NULL
        AND "clientSubmissionId" IS NULL
        AND "payloadHash" IS NULL)
      OR
      ("createdByActorId" IS NOT NULL
        AND "clientSubmissionId" IS NOT NULL
        AND "payloadHash" IS NOT NULL)
    )
  );

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_accountId_id_readySetupSnapshotId_fkey"
  FOREIGN KEY ("accountId", "id", "readySetupSnapshotId")
  REFERENCES "GameSetupSnapshot"("accountId", "gameId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE FUNCTION "validate_game_ready_setup"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."readySetupSnapshotId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "GameSetupSnapshot" AS setup
    WHERE setup."accountId" = NEW."accountId"
      AND setup."gameId" = NEW."id"
      AND setup."id" = NEW."readySetupSnapshotId"
      AND setup."setupRevision" = NEW."setupRevision"
  ) THEN
    RAISE EXCEPTION
      'ready setup pointer must match the current setup revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Game_ready_setup_check"
  BEFORE INSERT OR UPDATE ON "Game"
  FOR EACH ROW EXECUTE FUNCTION "validate_game_ready_setup"();

CREATE UNIQUE INDEX
  "Game_accountId_id_readySetupSnapshotId_key"
  ON "Game"("accountId", "id", "readySetupSnapshotId");

CREATE UNIQUE INDEX
  "GameSetupSnapshot_setup_submission_key"
  ON "GameSetupSnapshot"(
    "accountId",
    "gameId",
    "createdByActorId",
    "clientSubmissionId"
  );
