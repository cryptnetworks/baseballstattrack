-- Keep extension-owned objects out of the API-exposed public schema.
CREATE SCHEMA IF NOT EXISTS "extensions";
ALTER EXTENSION "btree_gist" SET SCHEMA "extensions";

-- Trigger and constraint helpers resolve application tables from a fixed path.
-- They execute through their owning triggers/constraints and are not public RPCs.
ALTER FUNCTION "prevent_append_only_mutation"() SET search_path = pg_catalog, public;
ALTER FUNCTION "protect_invitation_authority"() SET search_path = pg_catalog, public;
ALTER FUNCTION "prevent_column_mutation"() SET search_path = pg_catalog, public;
ALTER FUNCTION "validate_game_team_snapshot"() SET search_path = pg_catalog, public;
ALTER FUNCTION "validate_lineup_slot_snapshot"() SET search_path = pg_catalog, public;
ALTER FUNCTION "validate_game_ready_setup"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_webhook_event_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_webhook_endpoint_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "protect_external_record_evidence"() SET search_path = pg_catalog, public;
ALTER FUNCTION "protect_analytics_observation_evidence"() SET search_path = pg_catalog, public;
ALTER FUNCTION "enforce_analytics_observation_ordinal"() SET search_path = pg_catalog, public;
ALTER FUNCTION "deny_analytics_observation_delete"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_notification_delivery_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_notification_attempt_mutation"() SET search_path = pg_catalog, public;
ALTER FUNCTION "discord_update_triggers_are_unique"("DiscordUpdateTrigger"[]) SET search_path = pg_catalog, public;
ALTER FUNCTION "enforce_discord_enabled_settings"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_discord_installation_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_discord_destination_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_discord_settings_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "discord_control_actions_are_unique"("DiscordControlAction"[]) SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_discord_guild_role_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "reject_discord_role_grant_identity_update"() SET search_path = pg_catalog, public;
ALTER FUNCTION "enforce_active_discord_role_grant"() SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION "prevent_append_only_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_invitation_authority"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "prevent_column_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_game_team_snapshot"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_lineup_slot_snapshot"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_game_ready_setup"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_webhook_event_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_webhook_endpoint_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_external_record_evidence"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_analytics_observation_evidence"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "enforce_analytics_observation_ordinal"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "deny_analytics_observation_delete"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_notification_delivery_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_notification_attempt_mutation"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "discord_update_triggers_are_unique"("DiscordUpdateTrigger"[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "enforce_discord_enabled_settings"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_discord_installation_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_discord_destination_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_discord_settings_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "discord_control_actions_are_unique"("DiscordControlAction"[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_discord_guild_role_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "reject_discord_role_grant_identity_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "enforce_active_discord_role_grant"() FROM PUBLIC;

-- Supabase API roles are not present in vanilla PostgreSQL CI. Remove any
-- role-specific grants when those roles exist without making the migration
-- platform-dependent.
DO $$
DECLARE
  api_role TEXT;
  helper RECORD;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOR helper IN
        SELECT procedure.proname, pg_get_function_identity_arguments(procedure.oid) AS arguments
        FROM pg_proc AS procedure
        INNER JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = ANY (ARRAY[
            'prevent_append_only_mutation',
            'protect_invitation_authority',
            'prevent_column_mutation',
            'validate_game_team_snapshot',
            'validate_lineup_slot_snapshot',
            'validate_game_ready_setup',
            'reject_webhook_event_update',
            'reject_webhook_endpoint_identity_update',
            'protect_external_record_evidence',
            'protect_analytics_observation_evidence',
            'enforce_analytics_observation_ordinal',
            'deny_analytics_observation_delete',
            'reject_notification_delivery_identity_update',
            'reject_notification_attempt_mutation',
            'discord_update_triggers_are_unique',
            'enforce_discord_enabled_settings',
            'reject_discord_installation_identity_update',
            'reject_discord_destination_identity_update',
            'reject_discord_settings_identity_update',
            'discord_control_actions_are_unique',
            'reject_discord_guild_role_identity_update',
            'reject_discord_role_grant_identity_update',
            'enforce_active_discord_role_grant'
          ])
      LOOP
        EXECUTE format(
          'REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I',
          'public',
          helper.proname,
          helper.arguments,
          api_role
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
