import { Client } from "pg";

import {
  deploymentConfiguration,
  runtimeSecretConfiguration,
} from "@/server/config/runtime-environment";

export type ApplicationReadiness = {
  status: "ready" | "not_ready";
  checks: {
    configuration: boolean;
    database: boolean;
    schema: boolean;
    migration: boolean;
  };
};

type ReadinessEnvironment = {
  DATABASE_URL?: string | undefined;
  REQUIRED_DATABASE_MIGRATION?: string | undefined;
};

type DatabaseReadiness = {
  database: boolean;
  schema: boolean;
  migration: boolean;
};

type DatabaseProbe = (
  databaseUrl: string,
  requiredMigration: string,
) => Promise<DatabaseReadiness>;

async function probeDatabase(
  databaseUrl: string,
  requiredMigration: string,
): Promise<DatabaseReadiness> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1_500,
    query_timeout: 1_500,
    statement_timeout: 1_500,
  });

  try {
    await client.connect();

    const relationResult = await client.query<{
      migrationTable: string | null;
      sourceEventTable: string | null;
    }>(`
      SELECT
        to_regclass('public."_prisma_migrations"')::text AS "migrationTable",
        to_regclass('public."SourceEvent"')::text AS "sourceEventTable"
    `);
    const relations = relationResult.rows[0];

    if (!relations?.migrationTable) {
      return {
        database: true,
        schema: false,
        migration: false,
      };
    }

    const migrationResult = await client.query<{
      requiredApplied: boolean;
      failedMigration: boolean;
    }>(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM public."_prisma_migrations"
            WHERE migration_name = $1
              AND finished_at IS NOT NULL
              AND rolled_back_at IS NULL
          ) AS "requiredApplied",
          EXISTS (
            SELECT 1
            FROM public."_prisma_migrations"
            WHERE finished_at IS NULL
              AND rolled_back_at IS NULL
          ) AS "failedMigration"
      `,
      [requiredMigration],
    );
    const migrations = migrationResult.rows[0];

    return {
      database: true,
      schema: Boolean(relations.sourceEventTable),
      migration:
        Boolean(migrations?.requiredApplied) &&
        !Boolean(migrations?.failedMigration),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function getApplicationReadiness(
  environment: ReadinessEnvironment = {
    DATABASE_URL: runtimeSecretConfiguration().databaseUrl,
    REQUIRED_DATABASE_MIGRATION:
      deploymentConfiguration().requiredDatabaseMigration,
  },
  databaseProbe: DatabaseProbe = probeDatabase,
): Promise<ApplicationReadiness> {
  const databaseUrl = environment.DATABASE_URL;
  const requiredMigration = environment.REQUIRED_DATABASE_MIGRATION;

  if (
    !databaseUrl ||
    !requiredMigration ||
    !/^\d{14}_[a-z0-9_]+$/.test(requiredMigration)
  ) {
    return {
      status: "not_ready",
      checks: {
        configuration: false,
        database: false,
        schema: false,
        migration: false,
      },
    };
  }

  try {
    const databaseReadiness = await databaseProbe(
      databaseUrl,
      requiredMigration,
    );
    const ready =
      databaseReadiness.database &&
      databaseReadiness.schema &&
      databaseReadiness.migration;

    return {
      status: ready ? "ready" : "not_ready",
      checks: {
        configuration: true,
        ...databaseReadiness,
      },
    };
  } catch {
    return {
      status: "not_ready",
      checks: {
        configuration: true,
        database: false,
        schema: false,
        migration: false,
      },
    };
  }
}
