import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migration verification");
}

const expectedConstraints = [
  "Account_externalId_key",
  "AccountMembership_active_user_key",
  "DataExportArtifact_token_state_check",
  "DataExportArtifact_terminal_time_check",
  "EventCorrection_shape_check",
  "GameTeamSnapshot_internal_team_season_key",
  "GameSetupSnapshot_management_shape_check",
  "GameSetupSnapshot_setup_submission_key",
  "Game_accountId_id_readySetupSnapshotId_fkey",
  "Game_accountId_id_readySetupSnapshotId_key",
  "Game_setup_state_check",
  "Game_accountId_externalId_key",
  "LineupSlotSnapshot_fielding_position_key",
  "LineupSlotSnapshot_player_key",
  "LineupSlotSnapshot_roster_entry_key",
  "LineupSlotSnapshot_starting_pitcher_position_check",
  "MembershipInvitation_shape_check",
  "MembershipRoleAssignment_scope_check",
  "PrivacyHold_release_check",
  "PrivacyLifecycleRequest_account_target_check",
  "PrivacyLifecycleRequest_active_target_key",
  "PrivacyLifecycleRequest_terminal_time_check",
  "ProjectionCheckpoint_scope_check",
  "RateLimitCharge_operation_key",
  "RateLimitCharge_values_check",
  "RateLimitCounter_values_check",
  "RateLimitCounter_window_key",
  "RateLimitOverride_actor_shape_check",
  "RateLimitOverride_revoke_check",
  "RateLimitOverride_values_check",
  "WebhookEndpoint_accountId_externalId_key",
  "WebhookEndpoint_accountId_url_key",
  "WebhookEndpoint_lifecycle_check",
  "WebhookEndpoint_secret_version_check",
  "WebhookEndpoint_subscriptions_check",
  "WebhookEvent_version_retention_check",
  "WebhookDelivery_lifecycle_check",
  "WebhookDelivery_values_check",
  "WebhookDeliveryAttempt_values_check",
  "RosterEntry_active_player_key",
  "RosterEntry_no_overlapping_periods",
  "RosterEntry_period_revision_check",
  "RosterEntry_accountId_playerId_startsAt_id_idx",
  "RosterEntry_accountId_teamSeasonId_startsAt_id_idx",
  "Player_accountId_displayName_id_idx",
  "Player_accountId_externalId_key",
  "Season_accountId_displayName_id_idx",
  "Season_accountId_externalId_key",
  "Team_accountId_displayName_id_idx",
  "Team_accountId_externalId_key",
  "Season_revision_nonnegative_check",
  "Team_revision_nonnegative_check",
  "TeamSeason_revision_nonnegative_check",
  "Player_revision_nonnegative_check",
  "SecurityAuditRecord_scope_check",
  "SourceEvent_standalone_idempotency_key",
  "SourceEvent_shape_check",
  "SourceEvent_accountId_gameId_setupSnapshotId_fkey",
  "SourceEvent_setup_playTransaction_fkey",
  "SourceEvent_accountId_gameId_setupSnapshotId_sequence_idx",
  "PlayTransaction_accountId_gameId_setupSnapshotId_fkey",
  "PlayTransaction_accountId_gameId_setupSnapshotId_id_key",
];

const expectedTriggers = [
  "Account_identity_immutable",
  "EventCorrection_append_only",
  "GameSetupSnapshot_append_only",
  "GameTeamSnapshot_append_only",
  "GameTeamSnapshot_season_check",
  "Game_identity_immutable",
  "Game_ready_setup_check",
  "LineupSlotSnapshot_append_only",
  "LineupSlotSnapshot_lineage_check",
  "MembershipInvitation_authority_immutable",
  "Player_identity_immutable",
  "PrivacyOverlay_append_only",
  "RosterEntry_identity_immutable",
  "SourceEvent_append_only",
  "TeamSeason_identity_immutable",
  "WebhookEndpoint_identity_immutable",
  "WebhookEvent_immutable",
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
