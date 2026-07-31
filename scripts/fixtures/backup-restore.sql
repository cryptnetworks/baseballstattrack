INSERT INTO "Account" ("id", "slug", "displayName", "updatedAt")
VALUES
  ('restore-account-a', 'restore-account-a', 'Synthetic Restore Account A', CURRENT_TIMESTAMP),
  ('restore-account-b', 'restore-account-b', 'Synthetic Restore Account B', CURRENT_TIMESTAMP);

INSERT INTO "AppUser" ("id", "provider", "providerSubject", "updatedAt")
VALUES ('restore-user-a', 'synthetic', 'restore-user-a', CURRENT_TIMESTAMP);

INSERT INTO "AccountMembership"
  ("id", "accountId", "userId", "status", "updatedAt", "activatedAt")
VALUES
  ('restore-membership-a', 'restore-account-a', 'restore-user-a', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "MembershipRoleAssignment"
  ("id", "accountId", "membershipId", "role", "scope")
VALUES
  ('restore-role-a', 'restore-account-a', 'restore-membership-a', 'OWNER', 'ACCOUNT');

INSERT INTO "Team" ("id", "accountId", "displayName", "updatedAt")
VALUES
  ('restore-team-a', 'restore-account-a', 'Synthetic Restore Team A', CURRENT_TIMESTAMP),
  ('restore-team-b', 'restore-account-b', 'Synthetic Restore Team B', CURRENT_TIMESTAMP);

INSERT INTO "Season" ("id", "accountId", "displayName", "status", "updatedAt")
VALUES ('restore-season-a', 'restore-account-a', 'Synthetic 2027', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "TeamSeason" ("id", "accountId", "teamId", "seasonId", "updatedAt")
VALUES ('restore-team-season-a', 'restore-account-a', 'restore-team-a', 'restore-season-a', CURRENT_TIMESTAMP);

INSERT INTO "Player" ("id", "accountId", "displayName", "updatedAt")
VALUES ('restore-player-a', 'restore-account-a', 'Synthetic Restore Player', CURRENT_TIMESTAMP);

INSERT INTO "RosterEntry"
  ("id", "accountId", "playerId", "teamSeasonId", "status", "updatedAt")
VALUES
  ('restore-roster-a', 'restore-account-a', 'restore-player-a', 'restore-team-season-a', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "RulesetVersion" ("id", "accountId", "name", "version", "configuration")
VALUES ('restore-ruleset-a', 'restore-account-a', 'synthetic-restore', 1, '{"scheduledInnings": 1}'::jsonb);

INSERT INTO "Game"
  ("id", "accountId", "seasonId", "teamSeasonId", "status", "revision", "updatedAt")
VALUES
  ('restore-game-a', 'restore-account-a', 'restore-season-a', 'restore-team-season-a', 'DRAFT', 0, CURRENT_TIMESTAMP);

INSERT INTO "GameSetupSnapshot"
  ("id", "accountId", "gameId", "setupRevision", "rulesetVersionId", "scheduledInnings")
VALUES ('restore-setup-a', 'restore-account-a', 'restore-game-a', 1, 'restore-ruleset-a', 1);

UPDATE "Game"
SET "status" = 'CORRECTED',
    "revision" = 4,
    "setupRevision" = 1,
    "readySetupSnapshotId" = 'restore-setup-a'
WHERE "id" = 'restore-game-a';

INSERT INTO "SourceEvent"
  ("id", "accountId", "gameId", "setupSnapshotId", "sequence", "eventType",
   "schemaVersion", "rulesetVersionId", "clientSubmissionId", "expectedRevision",
   "acceptedRevision", "payloadHash", "payload", "actorKind", "actorId", "recordedAt")
VALUES
  ('restore-event-start', 'restore-account-a', 'restore-game-a', 'restore-setup-a', 1, 'GameStarted', 1, 'restore-ruleset-a', 'restore-submit-1', 0, 1, 'restore-hash-1', '{}'::jsonb, 'SERVICE', 'restore-service', '2027-01-01T00:00:01Z'),
  ('restore-event-play', 'restore-account-a', 'restore-game-a', 'restore-setup-a', 2, 'PlateAppearanceRecorded', 1, 'restore-ruleset-a', 'restore-submit-2', 1, 2, 'restore-hash-2', '{"outcome":"single"}'::jsonb, 'SERVICE', 'restore-service', '2027-01-01T00:00:02Z'),
  ('restore-event-correction', 'restore-account-a', 'restore-game-a', 'restore-setup-a', 3, 'CorrectionApplied', 1, 'restore-ruleset-a', 'restore-submit-3', 2, 3, 'restore-hash-3', '{"reasonCode":"SCORER_DECISION"}'::jsonb, 'SERVICE', 'restore-service', '2027-01-01T00:00:03Z'),
  ('restore-event-replacement', 'restore-account-a', 'restore-game-a', 'restore-setup-a', 4, 'PlateAppearanceRecorded', 1, 'restore-ruleset-a', 'restore-submit-4', 3, 4, 'restore-hash-4', '{"outcome":"reached_on_error"}'::jsonb, 'SERVICE', 'restore-service', '2027-01-01T00:00:04Z');

INSERT INTO "EventCorrection"
  ("id", "accountId", "gameId", "correctionEventId", "targetEventId", "replacementEventId", "policy")
VALUES
  ('restore-correction-a', 'restore-account-a', 'restore-game-a', 'restore-event-correction', 'restore-event-play', 'restore-event-replacement', 'REPLACE_PLAY');

INSERT INTO "ProjectionCheckpoint"
  ("id", "accountId", "scope", "gameId", "sourceRevision", "privacyOverlayRevision",
   "derivationVersion", "status", "updatedAt")
VALUES
  ('restore-projection-a', 'restore-account-a', 'GAME', 'restore-game-a', 4, 0, 1, 'CURRENT', CURRENT_TIMESTAMP);

INSERT INTO "SecurityAuditRecord"
  ("id", "scope", "accountId", "actorKind", "actorId", "action", "capability",
   "targetType", "targetId", "outcome", "correlationId")
VALUES
  ('restore-audit-a', 'ACCOUNT', 'restore-account-a', 'SERVICE', 'restore-service',
   'game.correction.apply', 'game.correct', 'GAME', 'restore-game-a', 'SUCCEEDED',
   'restore-correlation-a');
