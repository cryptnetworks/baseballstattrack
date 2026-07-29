-- Issue #13 adds explicit management revisions and historical roster periods.
-- Existing roster creation timestamps are the safest non-lossy period start.
CREATE TYPE "BattingSide" AS ENUM ('LEFT', 'RIGHT', 'SWITCH');
CREATE TYPE "ThrowingHand" AS ENUM ('LEFT', 'RIGHT');

ALTER TABLE "Team"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Season"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TeamSeason"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Player"
  ADD COLUMN "battingSide" "BattingSide",
  ADD COLUMN "throwingHand" "ThrowingHand",
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RosterEntry"
  ADD COLUMN "primaryPosition" "BaseballPosition",
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

UPDATE "RosterEntry"
SET "startsAt" = "createdAt"
WHERE "startsAt" IS NULL;

UPDATE "RosterEntry"
SET "endsAt" = GREATEST(
  COALESCE("archivedAt", "updatedAt"),
  "startsAt" + INTERVAL '1 millisecond'
)
WHERE "status" <> 'ACTIVE'
  AND "endsAt" IS NULL;

ALTER TABLE "RosterEntry"
  ALTER COLUMN "startsAt" SET NOT NULL,
  ALTER COLUMN "startsAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Team" ADD CONSTRAINT "Team_revision_nonnegative_check"
  CHECK ("revision" >= 0);
ALTER TABLE "Season" ADD CONSTRAINT "Season_revision_nonnegative_check"
  CHECK ("revision" >= 0);
ALTER TABLE "TeamSeason" ADD CONSTRAINT "TeamSeason_revision_nonnegative_check"
  CHECK ("revision" >= 0);
ALTER TABLE "Player" ADD CONSTRAINT "Player_revision_nonnegative_check"
  CHECK ("revision" >= 0);
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_period_revision_check"
  CHECK (
    "revision" >= 0
    AND ("endsAt" IS NULL OR "endsAt" > "startsAt")
    AND (("status" = 'ACTIVE' AND "endsAt" IS NULL)
      OR ("status" <> 'ACTIVE' AND "endsAt" IS NOT NULL))
  );

-- Historical periods for the same player/team-season may be adjacent but may
-- never overlap. The existing partial unique index remains the final authority
-- for at most one ACTIVE period.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "RosterEntry"
  ADD CONSTRAINT "RosterEntry_no_overlapping_periods"
  EXCLUDE USING gist (
    "accountId" WITH =,
    "teamSeasonId" WITH =,
    "playerId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  );

CREATE INDEX "RosterEntry_accountId_teamSeasonId_startsAt_id_idx"
  ON "RosterEntry"("accountId", "teamSeasonId", "startsAt", "id");
CREATE INDEX "RosterEntry_accountId_playerId_startsAt_id_idx"
  ON "RosterEntry"("accountId", "playerId", "startsAt", "id");
CREATE INDEX "Team_accountId_displayName_id_idx"
  ON "Team"("accountId", "displayName", "id");
CREATE INDEX "Season_accountId_displayName_id_idx"
  ON "Season"("accountId", "displayName", "id");
CREATE INDEX "Player_accountId_displayName_id_idx"
  ON "Player"("accountId", "displayName", "id");
