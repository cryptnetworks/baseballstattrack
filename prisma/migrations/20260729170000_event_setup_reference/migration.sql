-- Deterministic replay requires every accepted transaction and event to name
-- the exact immutable setup snapshot used as its initial-state boundary.
ALTER TABLE "PlayTransaction" ADD COLUMN "setupSnapshotId" TEXT;
ALTER TABLE "SourceEvent" ADD COLUMN "setupSnapshotId" TEXT;
ALTER TABLE "EventCorrection" ADD COLUMN "replacementPayloadId" TEXT;

-- Issue #10 supports an immutable, typed replacement body embedded in the
-- correction source event. The relational edge records that body's stable ID;
-- legacy replacement-event references remain supported.
ALTER TABLE "EventCorrection" DROP CONSTRAINT "EventCorrection_shape_check";
ALTER TABLE "EventCorrection" ADD CONSTRAINT "EventCorrection_shape_check"
  CHECK (
    "correctionEventId" <> "targetEventId" AND
    ("replacementEventId" IS NULL OR "replacementEventId" <> "targetEventId") AND
    (("policy" = 'REVERSE_EVENTS' AND
      "replacementEventId" IS NULL AND "replacementPayloadId" IS NULL) OR
      ("policy" <> 'REVERSE_EVENTS' AND
        (("replacementEventId" IS NOT NULL)::integer +
         ("replacementPayloadId" IS NOT NULL)::integer = 1)))
  );

-- Existing source rows can be attributed only when exactly one immutable setup
-- for the same game also carries the recorded ruleset. Ambiguity fails below
-- instead of silently changing historical meaning.
UPDATE "SourceEvent" AS event
SET "setupSnapshotId" = (
  SELECT MIN(snapshot."id")
  FROM "GameSetupSnapshot" AS snapshot
  WHERE snapshot."accountId" = event."accountId"
    AND snapshot."gameId" = event."gameId"
    AND snapshot."rulesetVersionId" = event."rulesetVersionId"
  GROUP BY snapshot."accountId", snapshot."gameId"
  HAVING COUNT(*) = 1
);

-- A transaction inherits the single setup resolved by all of its component
-- events. Empty legacy transactions are attributable only when their game has
-- exactly one setup snapshot.
UPDATE "PlayTransaction" AS transaction
SET "setupSnapshotId" = resolved."setupSnapshotId"
FROM (
  SELECT event."playTransactionId", MIN(event."setupSnapshotId") AS "setupSnapshotId"
  FROM "SourceEvent" AS event
  WHERE event."playTransactionId" IS NOT NULL
    AND event."setupSnapshotId" IS NOT NULL
  GROUP BY event."playTransactionId"
  HAVING COUNT(DISTINCT event."setupSnapshotId") = 1
) AS resolved
WHERE transaction."id" = resolved."playTransactionId";

UPDATE "PlayTransaction" AS transaction
SET "setupSnapshotId" = (
  SELECT MIN(snapshot."id")
  FROM "GameSetupSnapshot" AS snapshot
  WHERE snapshot."accountId" = transaction."accountId"
    AND snapshot."gameId" = transaction."gameId"
  GROUP BY snapshot."accountId", snapshot."gameId"
  HAVING COUNT(*) = 1
)
WHERE transaction."setupSnapshotId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "SourceEvent" AS event
    WHERE event."playTransactionId" = transaction."id"
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PlayTransaction" WHERE "setupSnapshotId" IS NULL)
    OR EXISTS (SELECT 1 FROM "SourceEvent" WHERE "setupSnapshotId" IS NULL)
  THEN
    RAISE EXCEPTION 'accepted event history exists without an accepted setup snapshot';
  END IF;
END;
$$;

ALTER TABLE "PlayTransaction"
  ALTER COLUMN "setupSnapshotId" SET NOT NULL;
ALTER TABLE "SourceEvent"
  ALTER COLUMN "setupSnapshotId" SET NOT NULL;

CREATE INDEX "SourceEvent_accountId_gameId_setupSnapshotId_sequence_idx"
  ON "SourceEvent"("accountId", "gameId", "setupSnapshotId", "sequence");

CREATE UNIQUE INDEX "PlayTransaction_accountId_gameId_setupSnapshotId_id_key"
  ON "PlayTransaction"("accountId", "gameId", "setupSnapshotId", "id");

ALTER TABLE "PlayTransaction"
  ADD CONSTRAINT "PlayTransaction_accountId_gameId_setupSnapshotId_fkey"
  FOREIGN KEY ("accountId", "gameId", "setupSnapshotId")
  REFERENCES "GameSetupSnapshot"("accountId", "gameId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SourceEvent"
  ADD CONSTRAINT "SourceEvent_accountId_gameId_setupSnapshotId_fkey"
  FOREIGN KEY ("accountId", "gameId", "setupSnapshotId")
  REFERENCES "GameSetupSnapshot"("accountId", "gameId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SourceEvent"
  DROP CONSTRAINT "SourceEvent_accountId_gameId_playTransactionId_fkey";
ALTER TABLE "SourceEvent"
  ADD CONSTRAINT "SourceEvent_setup_playTransaction_fkey"
  FOREIGN KEY ("accountId", "gameId", "setupSnapshotId", "playTransactionId")
  REFERENCES "PlayTransaction"("accountId", "gameId", "setupSnapshotId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
