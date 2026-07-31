import assert from "node:assert/strict";

import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for representability verification");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const rejectWrite = async (name, statement, expectedCodes) => {
  assert.match(name, /^[a-z_]+$/);
  for (const code of expectedCodes) {
    assert.match(code, /^[0-9A-Z]{5}$/);
  }

  const expectedStates = expectedCodes.map((code) => `'${code}'`).join(", ");
  const blockTag = `$verify_${name}$`;

  await client.query(`
    DO ${blockTag}
    DECLARE
      rejected_state TEXT;
    BEGIN
      BEGIN
        ${statement};
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS rejected_state = RETURNED_SQLSTATE;
        IF rejected_state = ANY (ARRAY[${expectedStates}]) THEN
          RETURN;
        END IF;
        RAISE;
      END;

      RAISE EXCEPTION '${name} unexpectedly succeeded' USING ERRCODE = 'P0002';
    END;
    ${blockTag};
  `);
};

try {
  await client.query("BEGIN");

  await client.query(`
    INSERT INTO "Account" ("id", "slug", "displayName", "updatedAt")
    VALUES
      ('fixture-account-a', 'fixture-account-a', 'Synthetic Account A', CURRENT_TIMESTAMP),
      ('fixture-account-b', 'fixture-account-b', 'Synthetic Account B', CURRENT_TIMESTAMP);

    INSERT INTO "Team" ("id", "accountId", "displayName", "updatedAt")
    VALUES
      ('fixture-team-home', 'fixture-account-a', 'Synthetic Home', CURRENT_TIMESTAMP),
      ('fixture-team-next', 'fixture-account-a', 'Synthetic Next Team', CURRENT_TIMESTAMP),
      ('fixture-team-other-account', 'fixture-account-b', 'Synthetic Other Account', CURRENT_TIMESTAMP);

    INSERT INTO "Season" ("id", "accountId", "displayName", "status", "updatedAt")
    VALUES
      ('fixture-season-2026', 'fixture-account-a', '2026 Synthetic', 'COMPLETED', CURRENT_TIMESTAMP),
      ('fixture-season-2027', 'fixture-account-a', '2027 Synthetic', 'ACTIVE', CURRENT_TIMESTAMP);

    INSERT INTO "TeamSeason" ("id", "accountId", "teamId", "seasonId", "updatedAt")
    VALUES
      ('fixture-team-season-home-2026', 'fixture-account-a', 'fixture-team-home', 'fixture-season-2026', CURRENT_TIMESTAMP),
      ('fixture-team-season-home-2027', 'fixture-account-a', 'fixture-team-home', 'fixture-season-2027', CURRENT_TIMESTAMP),
      ('fixture-team-season-next-2026', 'fixture-account-a', 'fixture-team-next', 'fixture-season-2026', CURRENT_TIMESTAMP),
      ('fixture-team-season-next-2027', 'fixture-account-a', 'fixture-team-next', 'fixture-season-2027', CURRENT_TIMESTAMP);

    INSERT INTO "Player" ("id", "accountId", "displayName", "updatedAt")
    VALUES
      ('fixture-player-shared', 'fixture-account-a', 'Synthetic Shared Player', CURRENT_TIMESTAMP),
      ('fixture-player-pitcher', 'fixture-account-a', 'Synthetic Pitcher', CURRENT_TIMESTAMP),
      ('fixture-player-substitute', 'fixture-account-a', 'Synthetic Substitute', CURRENT_TIMESTAMP),
      ('fixture-player-visitor', 'fixture-account-a', 'Synthetic Visitor', CURRENT_TIMESTAMP),
      ('fixture-player-visitor-pitcher', 'fixture-account-a', 'Synthetic Visitor Pitcher', CURRENT_TIMESTAMP),
      ('fixture-player-account-b', 'fixture-account-b', 'Synthetic Account B Player', CURRENT_TIMESTAMP);

    INSERT INTO "RosterEntry"
      ("id", "accountId", "playerId", "teamSeasonId", "jerseyNumber", "status", "startsAt", "endsAt", "updatedAt", "archivedAt")
    VALUES
      ('fixture-roster-shared-old', 'fixture-account-a', 'fixture-player-shared', 'fixture-team-season-home-2026', '7', 'ARCHIVED', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('fixture-roster-shared-current', 'fixture-account-a', 'fixture-player-shared', 'fixture-team-season-home-2026', '17', 'ACTIVE', '2026-01-01T00:00:00Z', NULL, CURRENT_TIMESTAMP, NULL),
      ('fixture-roster-shared-next-team', 'fixture-account-a', 'fixture-player-shared', 'fixture-team-season-next-2027', '27', 'ACTIVE', '2027-01-01T00:00:00Z', NULL, CURRENT_TIMESTAMP, NULL),
      ('fixture-roster-pitcher', 'fixture-account-a', 'fixture-player-pitcher', 'fixture-team-season-home-2026', '22', 'ACTIVE', '2026-01-01T00:00:00Z', NULL, CURRENT_TIMESTAMP, NULL),
      ('fixture-roster-substitute', 'fixture-account-a', 'fixture-player-substitute', 'fixture-team-season-home-2026', '31', 'ACTIVE', '2026-01-01T00:00:00Z', NULL, CURRENT_TIMESTAMP, NULL),
      ('fixture-roster-visitor', 'fixture-account-a', 'fixture-player-visitor', 'fixture-team-season-next-2026', '4', 'ACTIVE', '2026-01-01T00:00:00Z', NULL, CURRENT_TIMESTAMP, NULL),
      ('fixture-roster-visitor-pitcher', 'fixture-account-a', 'fixture-player-visitor-pitcher', 'fixture-team-season-next-2026', '9', 'ACTIVE', '2026-01-01T00:00:00Z', NULL, CURRENT_TIMESTAMP, NULL);

    INSERT INTO "RulesetVersion"
      ("id", "accountId", "name", "version", "configuration")
    VALUES
      ('fixture-ruleset', 'fixture-account-a', 'synthetic-standard', 1, '{"scheduledInnings": 9, "extraInnings": true}'::jsonb);

    INSERT INTO "Game"
      ("id", "accountId", "seasonId", "teamSeasonId", "status", "revision", "updatedAt")
    VALUES
      ('fixture-game', 'fixture-account-a', 'fixture-season-2026', 'fixture-team-season-home-2026', 'DRAFT', 0, CURRENT_TIMESTAMP),
      ('fixture-game-external', 'fixture-account-a', 'fixture-season-2026', 'fixture-team-season-home-2026', 'DRAFT', 0, CURRENT_TIMESTAMP);

    INSERT INTO "GameSetupSnapshot"
      ("id", "accountId", "gameId", "setupRevision", "rulesetVersionId", "scheduledInnings", "acceptedAt")
    VALUES
      ('fixture-setup', 'fixture-account-a', 'fixture-game', 1, 'fixture-ruleset', 9, '2026-06-01T12:00:00Z'),
      ('fixture-setup-external', 'fixture-account-a', 'fixture-game-external', 1, 'fixture-ruleset', 9, '2026-06-01T12:00:00Z'),
      ('fixture-setup-season-check', 'fixture-account-a', 'fixture-game-external', 2, 'fixture-ruleset', 9, '2026-06-01T12:00:00Z');

    INSERT INTO "GameTeamSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "side", "teamId", "teamSeasonId", "displayName", "isAccountTeam", "createdAt")
    VALUES
      ('fixture-side-home', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'HOME', 'fixture-team-home', 'fixture-team-season-home-2026', 'Synthetic Home', TRUE, '2026-06-01T12:00:00Z'),
      ('fixture-side-away', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'AWAY', 'fixture-team-next', 'fixture-team-season-next-2026', 'Synthetic Visitor', TRUE, '2026-06-01T12:00:00Z'),
      ('fixture-side-external-home', 'fixture-account-a', 'fixture-game-external', 'fixture-setup-external', 'HOME', 'fixture-team-home', 'fixture-team-season-home-2026', 'Synthetic Home', TRUE, '2026-06-01T12:00:00Z'),
      ('fixture-side-external-away', 'fixture-account-a', 'fixture-game-external', 'fixture-setup-external', 'AWAY', NULL, NULL, 'Synthetic External Opponent', FALSE, '2026-06-01T12:00:00Z');

    INSERT INTO "LineupSlotSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "gameTeamSnapshotId", "playerId", "rosterEntryId", "displayName", "jerseyNumber", "battingOrder", "defensivePosition", "isStartingPitcher", "createdAt")
    VALUES
      ('fixture-lineup-home-1', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-home', 'fixture-player-shared', 'fixture-roster-shared-current', 'Synthetic Shared Player', '17', 1, 'SHORTSTOP', FALSE, '2026-06-01T12:00:00Z'),
      ('fixture-lineup-home-pitcher', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-home', 'fixture-player-pitcher', 'fixture-roster-pitcher', 'Synthetic Pitcher', '22', NULL, 'PITCHER', TRUE, '2026-06-01T12:00:00Z'),
      ('fixture-lineup-away-1', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-away', 'fixture-player-visitor', 'fixture-roster-visitor', 'Synthetic Visitor', '4', 1, 'CENTER_FIELD', FALSE, '2026-06-01T12:00:00Z'),
      ('fixture-lineup-away-pitcher', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-away', 'fixture-player-visitor-pitcher', 'fixture-roster-visitor-pitcher', 'Synthetic Visitor Pitcher', '9', NULL, 'PITCHER', TRUE, '2026-06-01T12:00:00Z');

    UPDATE "Game"
    SET "status" = 'READY',
        "setupRevision" = 1,
        "readySetupSnapshotId" = CASE "id"
          WHEN 'fixture-game' THEN 'fixture-setup'
          ELSE 'fixture-setup-external'
        END
    WHERE "id" IN ('fixture-game', 'fixture-game-external');

    INSERT INTO "SourceEvent"
      ("id", "accountId", "gameId", "setupSnapshotId", "sequence", "eventType", "schemaVersion", "rulesetVersionId", "clientSubmissionId", "expectedRevision", "acceptedRevision", "payloadHash", "payload", "actorKind", "actorId", "recordedAt")
    VALUES
      ('fixture-event-start', 'fixture-account-a', 'fixture-game', 'fixture-setup', 1, 'GameStarted', 1, 'fixture-ruleset', 'fixture-submit-1', 0, 1, 'fixture-hash-1', '{"inning": 1, "half": "top"}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:01:00Z'),
      ('fixture-event-substitution', 'fixture-account-a', 'fixture-game', 'fixture-setup', 2, 'DefensiveSubstitutionMade', 1, 'fixture-ruleset', 'fixture-submit-2', 1, 2, 'fixture-hash-2', '{"outgoingPlayerId": "fixture-player-shared", "incomingPlayerId": "fixture-player-substitute"}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:02:00Z'),
      ('fixture-event-alignment', 'fixture-account-a', 'fixture-game', 'fixture-setup', 3, 'DefensiveAlignmentChanged', 1, 'fixture-ruleset', 'fixture-submit-3', 2, 3, 'fixture-hash-3', '{"playerId": "fixture-player-substitute", "from": "SHORTSTOP", "to": "SECOND_BASE"}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:03:00Z'),
      ('fixture-event-pitching-1', 'fixture-account-a', 'fixture-game', 'fixture-setup', 4, 'PitchingChangeMade', 1, 'fixture-ruleset', 'fixture-submit-4', 3, 4, 'fixture-hash-4', '{"outgoingPlayerId": "fixture-player-pitcher", "incomingPlayerId": "fixture-player-substitute", "inheritedRunners": []}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:04:00Z'),
      ('fixture-event-pitching-2', 'fixture-account-a', 'fixture-game', 'fixture-setup', 5, 'PitchingChangeMade', 1, 'fixture-ruleset', 'fixture-submit-5', 4, 5, 'fixture-hash-5', '{"outgoingPlayerId": "fixture-player-substitute", "incomingPlayerId": "fixture-player-pitcher", "inheritedRunners": []}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:05:00Z'),
      ('fixture-event-extra-inning', 'fixture-account-a', 'fixture-game', 'fixture-setup', 6, 'PlateAppearanceRecorded', 1, 'fixture-ruleset', 'fixture-submit-6', 5, 6, 'fixture-hash-6', '{"inning": 10, "half": "top", "outcome": "single"}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:06:00Z'),
      ('fixture-event-correction', 'fixture-account-a', 'fixture-game', 'fixture-setup', 7, 'CorrectionApplied', 1, 'fixture-ruleset', 'fixture-submit-7', 6, 7, 'fixture-hash-7', '{"reasonCode": "SCORER_DECISION"}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:07:00Z'),
      ('fixture-event-replacement', 'fixture-account-a', 'fixture-game', 'fixture-setup', 8, 'PlateAppearanceRecorded', 1, 'fixture-ruleset', 'fixture-submit-8', 7, 8, 'fixture-hash-8', '{"inning": 10, "half": "top", "outcome": "reached_on_error"}'::jsonb, 'SERVICE', 'fixture-scorekeeper-service', '2026-06-01T12:08:00Z');

    INSERT INTO "EventCorrection"
      ("id", "accountId", "gameId", "correctionEventId", "targetEventId", "replacementEventId", "policy", "createdAt")
    VALUES
      ('fixture-correction-link', 'fixture-account-a', 'fixture-game', 'fixture-event-correction', 'fixture-event-extra-inning', 'fixture-event-replacement', 'REPLACE_PLAY', '2026-06-01T12:09:00Z');

    INSERT INTO "PrivacyOverlay"
      ("id", "accountId", "effectiveOrder", "reasonCode", "actorId", "correlationId", "createdAt")
    VALUES
      ('fixture-overlay', 'fixture-account-a', 1, 'PLAYER_PSEUDONYMIZED', 'fixture-privacy-service', 'fixture-correlation', '2026-06-02T12:00:00Z');

    INSERT INTO "PrivacyOverlayField"
      ("id", "accountId", "privacyOverlayId", "playerId", "field", "replacementValue", "createdAt")
    VALUES
      ('fixture-overlay-player-name', 'fixture-account-a', 'fixture-overlay', 'fixture-player-shared', 'PLAYER_DISPLAY_NAME', 'Synthetic Pseudonym', '2026-06-02T12:00:00Z');

    INSERT INTO "ProjectionCheckpoint"
      ("id", "accountId", "scope", "gameId", "sourceRevision", "privacyOverlayRevision", "derivationVersion", "status", "updatedAt")
    VALUES
      ('fixture-projection', 'fixture-account-a', 'GAME', 'fixture-game', 8, 1, 1, 'STALE', CURRENT_TIMESTAMP);
  `);

  await rejectWrite(
    "duplicate_active_roster",
    `INSERT INTO "RosterEntry"
      ("id", "accountId", "playerId", "teamSeasonId", "status", "updatedAt")
     VALUES
      ('fixture-roster-duplicate', 'fixture-account-a', 'fixture-player-shared', 'fixture-team-season-home-2026', 'ACTIVE', CURRENT_TIMESTAMP)`,
    ["23505"],
  );

  await rejectWrite(
    "cross_account_roster",
    `INSERT INTO "RosterEntry"
      ("id", "accountId", "playerId", "teamSeasonId", "status", "updatedAt")
     VALUES
      ('fixture-roster-cross-account', 'fixture-account-a', 'fixture-player-account-b', 'fixture-team-season-home-2026', 'ACTIVE', CURRENT_TIMESTAMP)`,
    ["23503"],
  );

  await rejectWrite(
    "cross_account_team_movement",
    `UPDATE "Team"
        SET "accountId" = 'fixture-account-b'
      WHERE "id" = 'fixture-team-home'`,
    ["P0001"],
  );

  await rejectWrite(
    "mismatched_ready_setup_revision",
    `UPDATE "Game"
        SET "readySetupSnapshotId" = 'fixture-setup-season-check'
      WHERE "id" = 'fixture-game-external'`,
    ["P0001"],
  );

  await rejectWrite(
    "roster_identity_rewrite",
    `UPDATE "RosterEntry"
        SET "playerId" = 'fixture-player-substitute'
      WHERE "id" = 'fixture-roster-shared-current'`,
    ["P0001"],
  );

  await rejectWrite(
    "duplicate_lineup_player",
    `INSERT INTO "LineupSlotSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "gameTeamSnapshotId", "playerId", "rosterEntryId", "displayName", "battingOrder", "defensivePosition")
     VALUES
      ('fixture-lineup-duplicate-player', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-home', 'fixture-player-shared', 'fixture-roster-shared-current', 'Duplicate', 3, 'LEFT_FIELD')`,
    ["23505"],
  );

  await rejectWrite(
    "duplicate_fielding_position",
    `INSERT INTO "LineupSlotSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "gameTeamSnapshotId", "playerId", "rosterEntryId", "displayName", "battingOrder", "defensivePosition")
     VALUES
      ('fixture-lineup-duplicate-position', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-home', 'fixture-player-substitute', 'fixture-roster-substitute', 'Duplicate Position', 3, 'SHORTSTOP')`,
    ["23505"],
  );

  await rejectWrite(
    "mismatched_lineup_identity",
    `INSERT INTO "LineupSlotSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "gameTeamSnapshotId", "playerId", "rosterEntryId", "displayName", "battingOrder", "defensivePosition")
     VALUES
      ('fixture-lineup-mismatched', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-side-home', 'fixture-player-substitute', 'fixture-roster-shared-current', 'Mismatch', 3, 'LEFT_FIELD')`,
    ["P0001"],
  );

  await rejectWrite(
    "external_lineup_identity",
    `INSERT INTO "LineupSlotSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "gameTeamSnapshotId", "playerId", "rosterEntryId", "displayName", "battingOrder", "defensivePosition")
     VALUES
      ('fixture-lineup-external-identity', 'fixture-account-a', 'fixture-game-external', 'fixture-setup-external', 'fixture-side-external-away', 'fixture-player-substitute', 'fixture-roster-substitute', 'External Mismatch', 3, 'LEFT_FIELD')`,
    ["P0001"],
  );

  await rejectWrite(
    "wrong_season_game_participant",
    `INSERT INTO "GameTeamSnapshot"
      ("id", "accountId", "gameId", "setupSnapshotId", "side", "teamId", "teamSeasonId", "displayName", "isAccountTeam")
     VALUES
      ('fixture-side-wrong-season', 'fixture-account-a', 'fixture-game-external', 'fixture-setup-season-check', 'HOME', 'fixture-team-home', 'fixture-team-season-home-2027', 'Wrong Season', TRUE)`,
    ["P0001"],
  );

  await client.query(`
    INSERT INTO "AnalyticsObservation"
      ("id", "accountId", "gameId", "setupSnapshotId", "sourceEventId", "type", "version", "ordinal", "captureSource", "confidence", "payload", "actorId", "recordedAt")
    VALUES
      ('fixture-observation', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-event-replacement', 'PITCH_LOCATION', 1, 0, 'MANUAL', 'OBSERVED', '{"zoneCell":"MID_MIDDLE","result":"CALLED_STRIKE","pitchType":null}'::jsonb, 'fixture-scorekeeper-service', CURRENT_TIMESTAMP);
  `);

  await rejectWrite(
    "duplicate_active_observation",
    `INSERT INTO "AnalyticsObservation"
      ("id", "accountId", "gameId", "setupSnapshotId", "sourceEventId", "type", "version", "ordinal", "captureSource", "confidence", "payload", "actorId")
     VALUES
      ('fixture-observation-duplicate', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-event-replacement', 'PITCH_LOCATION', 1, 0, 'MANUAL', 'OBSERVED', '{"zoneCell":"MID_MIDDLE","result":"BALL","pitchType":null}'::jsonb, 'fixture-scorekeeper-service')`,
    ["P0001"],
  );

  await rejectWrite(
    "analytics_observation_identity_rewrite",
    `UPDATE "AnalyticsObservation"
        SET "payload" = '{"zoneCell":"UP_LEFT","result":"BALL","pitchType":null}'::jsonb
      WHERE "id" = 'fixture-observation'`,
    ["P0001"],
  );

  await client.query(`
    INSERT INTO "AnalyticsObservation"
      ("id", "accountId", "gameId", "setupSnapshotId", "sourceEventId", "type", "version", "ordinal", "captureSource", "confidence", "payload", "actorId", "supersedesObservationId", "recordedAt")
    VALUES
      ('fixture-observation-replacement', 'fixture-account-a', 'fixture-game', 'fixture-setup', 'fixture-event-replacement', 'PITCH_LOCATION', 1, 0, 'MANUAL', 'OBSERVED', '{"zoneCell":"UP_LEFT","result":"BALL","pitchType":null}'::jsonb, 'fixture-scorekeeper-service', 'fixture-observation', CURRENT_TIMESTAMP);
  `);

  const observationShape = await client.query(
    `SELECT
       count(*)::integer AS observations,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "AnalyticsObservation" AS newer WHERE newer."supersedesObservationId" = observation."id"))::integer AS current_observations
       FROM "AnalyticsObservation" AS observation
      WHERE "gameId" = 'fixture-game'`,
  );
  assert.deepEqual(observationShape.rows[0], {
    observations: 2,
    current_observations: 1,
  });

  const accounts = await client.query(
    `SELECT count(*)::integer AS count FROM "Account" WHERE "id" LIKE 'fixture-account-%'`,
  );
  assert.equal(accounts.rows[0].count, 2);

  const teamSeasonHistory = await client.query(
    `SELECT count(*)::integer AS count
       FROM "TeamSeason"
      WHERE "accountId" = 'fixture-account-a'
        AND "teamId" = 'fixture-team-home'`,
  );
  assert.equal(teamSeasonHistory.rows[0].count, 2);

  const sharedPlayerHistory = await client.query(
    `SELECT count(DISTINCT "teamSeasonId")::integer AS team_seasons,
            array_agg("jerseyNumber" ORDER BY "id") AS jersey_numbers
       FROM "RosterEntry"
      WHERE "accountId" = 'fixture-account-a'
        AND "playerId" = 'fixture-player-shared'`,
  );
  assert.equal(sharedPlayerHistory.rows[0].team_seasons, 2);
  assert.deepEqual(sharedPlayerHistory.rows[0].jersey_numbers.sort(), [
    "17",
    "27",
    "7",
  ]);

  const gameShape = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM "GameTeamSnapshot" WHERE "setupSnapshotId" = 'fixture-setup') AS sides,
       (SELECT count(*)::integer FROM "GameTeamSnapshot" WHERE "setupSnapshotId" = 'fixture-setup' AND "isAccountTeam") AS internal_sides,
       (SELECT count(*)::integer FROM "GameTeamSnapshot" WHERE "setupSnapshotId" = 'fixture-setup-external' AND NOT "isAccountTeam") AS external_sides,
       (SELECT count(*)::integer FROM "LineupSlotSnapshot" WHERE "setupSnapshotId" = 'fixture-setup') AS lineup_slots`,
  );
  assert.deepEqual(gameShape.rows[0], {
    sides: 2,
    internal_sides: 2,
    external_sides: 1,
    lineup_slots: 4,
  });

  const eventShape = await client.query(
    `SELECT array_agg("sequence" ORDER BY "sequence") AS sequences,
            count(*) FILTER (WHERE "eventType" = 'PitchingChangeMade')::integer AS pitching_changes,
            count(*) FILTER (WHERE "payload" ->> 'inning' = '10')::integer AS extra_inning_events
       FROM "SourceEvent"
      WHERE "gameId" = 'fixture-game'`,
  );
  assert.deepEqual(eventShape.rows[0].sequences, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(eventShape.rows[0].pitching_changes, 2);
  assert.equal(eventShape.rows[0].extra_inning_events, 2);

  const correctionAndPrivacy = await client.query(
    `SELECT
       (SELECT count(*)::integer FROM "EventCorrection" WHERE "gameId" = 'fixture-game') AS corrections,
       (SELECT "displayName" FROM "Player" WHERE "id" = 'fixture-player-shared') AS original_player_name,
       (SELECT "displayName" FROM "LineupSlotSnapshot" WHERE "id" = 'fixture-lineup-home-1') AS original_snapshot_name,
       (SELECT "replacementValue" FROM "PrivacyOverlayField" WHERE "id" = 'fixture-overlay-player-name') AS overlay_name`,
  );
  assert.deepEqual(correctionAndPrivacy.rows[0], {
    corrections: 1,
    original_player_name: "Synthetic Shared Player",
    original_snapshot_name: "Synthetic Shared Player",
    overlay_name: "Synthetic Pseudonym",
  });
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
