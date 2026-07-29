-- Preserve roster history: a player may leave and later rejoin the same
-- team-season with a new roster period or jersey number, but only one row may
-- be active at a time.
DROP INDEX "RosterEntry_accountId_teamSeasonId_playerId_key";

CREATE UNIQUE INDEX "RosterEntry_active_player_key"
  ON "RosterEntry"("accountId", "teamSeasonId", "playerId")
  WHERE "status" = 'ACTIVE';

-- Stable ids, tenant ownership, and domain relationship identities cannot be
-- reassigned after creation. Lifecycle, display, scheduling, and roster-period
-- fields remain mutable where their models allow it.
CREATE FUNCTION "prevent_column_mutation"() RETURNS TRIGGER AS $$
DECLARE
  column_name TEXT;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> column_name IS DISTINCT FROM to_jsonb(OLD) -> column_name THEN
      RAISE EXCEPTION '% column %.% is immutable', TG_TABLE_NAME, TG_TABLE_NAME, column_name;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Account_identity_immutable" BEFORE UPDATE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id');
CREATE TRIGGER "AppUser_identity_immutable" BEFORE UPDATE ON "AppUser"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'provider', 'providerSubject');
CREATE TRIGGER "AccountMembership_identity_immutable" BEFORE UPDATE ON "AccountMembership"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'userId');
CREATE TRIGGER "MembershipInvitation_identity_immutable" BEFORE UPDATE ON "MembershipInvitation"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId');
CREATE TRIGGER "MembershipRoleAssignment_identity_immutable" BEFORE UPDATE ON "MembershipRoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'membershipId', 'role', 'scope', 'teamId', 'seasonId', 'gameId');
CREATE TRIGGER "CapabilityGrant_identity_immutable" BEFORE UPDATE ON "CapabilityGrant"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'membershipId', 'capability', 'scope', 'teamId', 'seasonId', 'gameId');
CREATE TRIGGER "Team_identity_immutable" BEFORE UPDATE ON "Team"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId');
CREATE TRIGGER "Season_identity_immutable" BEFORE UPDATE ON "Season"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId');
CREATE TRIGGER "TeamSeason_identity_immutable" BEFORE UPDATE ON "TeamSeason"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'teamId', 'seasonId');
CREATE TRIGGER "Player_identity_immutable" BEFORE UPDATE ON "Player"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId');
CREATE TRIGGER "RosterEntry_identity_immutable" BEFORE UPDATE ON "RosterEntry"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'playerId', 'teamSeasonId');
CREATE TRIGGER "RulesetVersion_identity_immutable" BEFORE UPDATE ON "RulesetVersion"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'name', 'version', 'configuration');
CREATE TRIGGER "Game_identity_immutable" BEFORE UPDATE ON "Game"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'seasonId', 'teamSeasonId');
CREATE TRIGGER "ProjectionCheckpoint_identity_immutable" BEFORE UPDATE ON "ProjectionCheckpoint"
  FOR EACH ROW EXECUTE FUNCTION "prevent_column_mutation"('id', 'accountId', 'scope', 'gameId', 'seasonId', 'sourceRevision', 'privacyOverlayRevision', 'derivationVersion');

-- Accounts may manage both opponents in one game. Preserve both stable team
-- identities while preventing the same team-season from occupying both sides.
DROP INDEX "GameTeamSnapshot_one_account_team_key";

CREATE UNIQUE INDEX "GameTeamSnapshot_internal_team_season_key"
  ON "GameTeamSnapshot"("setupSnapshotId", "teamSeasonId")
  WHERE "isAccountTeam";

CREATE FUNCTION "validate_game_team_snapshot"() RETURNS TRIGGER AS $$
DECLARE
  game_season_id TEXT;
  participant_season_id TEXT;
BEGIN
  IF NEW."isAccountTeam" THEN
    SELECT "seasonId"
      INTO game_season_id
      FROM "Game"
     WHERE "accountId" = NEW."accountId"
       AND "id" = NEW."gameId";

    SELECT "seasonId"
      INTO participant_season_id
      FROM "TeamSeason"
     WHERE "accountId" = NEW."accountId"
       AND "teamId" = NEW."teamId"
       AND "id" = NEW."teamSeasonId";

    IF game_season_id IS NULL
      OR participant_season_id IS NULL
      OR game_season_id IS DISTINCT FROM participant_season_id
    THEN
      RAISE EXCEPTION 'game participant team-season must match the game season';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GameTeamSnapshot_season_check"
  BEFORE INSERT ON "GameTeamSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "validate_game_team_snapshot"();

-- An accepted setup cannot assign the same known player, roster entry, or
-- conventional fielding position more than once on one game side. Designated
-- and extra hitters are batting roles, so they are not covered by the
-- defensive-position uniqueness rule.
CREATE UNIQUE INDEX "LineupSlotSnapshot_player_key"
  ON "LineupSlotSnapshot"("setupSnapshotId", "gameTeamSnapshotId", "playerId")
  WHERE "playerId" IS NOT NULL;

CREATE UNIQUE INDEX "LineupSlotSnapshot_roster_entry_key"
  ON "LineupSlotSnapshot"("setupSnapshotId", "gameTeamSnapshotId", "rosterEntryId")
  WHERE "rosterEntryId" IS NOT NULL;

CREATE UNIQUE INDEX "LineupSlotSnapshot_fielding_position_key"
  ON "LineupSlotSnapshot"("setupSnapshotId", "gameTeamSnapshotId", "defensivePosition")
  WHERE "defensivePosition" IS NOT NULL
    AND "defensivePosition" NOT IN ('DESIGNATED_HITTER', 'EXTRA_HITTER');

ALTER TABLE "LineupSlotSnapshot"
  ADD CONSTRAINT "LineupSlotSnapshot_starting_pitcher_position_check"
  CHECK (NOT "isStartingPitcher" OR "defensivePosition" = 'PITCHER');

-- Prisma cannot express the cross-row lineage check between an immutable game
-- side and its lineup slots. Internal sides must use a roster entry for the
-- same player and team-season; external opponents use snapshot-only names.
CREATE FUNCTION "validate_lineup_slot_snapshot"() RETURNS TRIGGER AS $$
DECLARE
  side_is_account_team BOOLEAN;
  side_team_season_id TEXT;
  roster_player_id TEXT;
  roster_team_season_id TEXT;
BEGIN
  SELECT "isAccountTeam", "teamSeasonId"
    INTO side_is_account_team, side_team_season_id
    FROM "GameTeamSnapshot"
   WHERE "accountId" = NEW."accountId"
     AND "gameId" = NEW."gameId"
     AND "setupSnapshotId" = NEW."setupSnapshotId"
     AND "id" = NEW."gameTeamSnapshotId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lineup side does not belong to the setup snapshot';
  END IF;

  IF side_is_account_team THEN
    IF NEW."playerId" IS NULL OR NEW."rosterEntryId" IS NULL THEN
      RAISE EXCEPTION 'account-team lineup slots require player and roster entry';
    END IF;

    SELECT "playerId", "teamSeasonId"
      INTO roster_player_id, roster_team_season_id
      FROM "RosterEntry"
     WHERE "accountId" = NEW."accountId"
       AND "id" = NEW."rosterEntryId";

    IF NOT FOUND
      OR roster_player_id IS DISTINCT FROM NEW."playerId"
      OR roster_team_season_id IS DISTINCT FROM side_team_season_id
    THEN
      RAISE EXCEPTION 'lineup player and roster entry must match the game side';
    END IF;
  ELSIF NEW."playerId" IS NOT NULL OR NEW."rosterEntryId" IS NOT NULL THEN
    RAISE EXCEPTION 'external-team lineup slots must use snapshot-only identity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LineupSlotSnapshot_lineage_check"
  BEFORE INSERT ON "LineupSlotSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "validate_lineup_slot_snapshot"();
