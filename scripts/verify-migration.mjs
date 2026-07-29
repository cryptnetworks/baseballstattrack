import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migration verification");
}

const expectedConstraints = [
  "AccountMembership_active_user_key",
  "EventCorrection_shape_check",
  "GameTeamSnapshot_internal_team_season_key",
  "LineupSlotSnapshot_fielding_position_key",
  "LineupSlotSnapshot_player_key",
  "LineupSlotSnapshot_roster_entry_key",
  "LineupSlotSnapshot_starting_pitcher_position_check",
  "MembershipInvitation_shape_check",
  "MembershipRoleAssignment_scope_check",
  "ProjectionCheckpoint_scope_check",
  "RosterEntry_active_player_key",
  "SecurityAuditRecord_scope_check",
  "SourceEvent_standalone_idempotency_key",
  "SourceEvent_shape_check",
];

const expectedTriggers = [
  "Account_identity_immutable",
  "EventCorrection_append_only",
  "GameSetupSnapshot_append_only",
  "GameTeamSnapshot_append_only",
  "GameTeamSnapshot_season_check",
  "Game_identity_immutable",
  "LineupSlotSnapshot_append_only",
  "LineupSlotSnapshot_lineage_check",
  "MembershipInvitation_authority_immutable",
  "Player_identity_immutable",
  "PrivacyOverlay_append_only",
  "RosterEntry_identity_immutable",
  "SourceEvent_append_only",
  "TeamSeason_identity_immutable",
];

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const constraints = await client.query(
    `SELECT conname AS name FROM pg_constraint
     UNION ALL
     SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const constraintNames = new Set(constraints.rows.map(({ name }) => name));

  for (const name of expectedConstraints) {
    if (!constraintNames.has(name)) {
      throw new Error(`migration is missing constraint or index ${name}`);
    }
  }

  const triggers = await client.query(
    `SELECT tgname AS name
     FROM pg_trigger
     WHERE NOT tgisinternal`,
  );
  const triggerNames = new Set(triggers.rows.map(({ name }) => name));

  for (const name of expectedTriggers) {
    if (!triggerNames.has(name)) {
      throw new Error(`migration is missing trigger ${name}`);
    }
  }

  const battingOrder = await client.query(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'LineupSlotSnapshot'
       AND column_name = 'battingOrder'`,
  );

  if (battingOrder.rows[0]?.is_nullable !== "YES") {
    throw new Error(
      "LineupSlotSnapshot.battingOrder must allow defensive-only players",
    );
  }
} finally {
  await client.end();
}
