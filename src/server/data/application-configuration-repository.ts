import { randomUUID } from "node:crypto";

import {
  ActorKind,
  AuditOutcome,
  AuditScope,
  ConfigurationRevisionSource,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  APPLICATION_CONFIGURATION_SCHEMA_VERSION,
  applicationConfigurationCategories,
  applicationConfigurationChangedCategories,
  applicationConfigurationDigest,
  applicationConfigurationValuesSchema,
  type ApplicationConfigurationValues,
} from "@/domain/application-configuration";
import type { TrustedActorContext } from "@/server/auth/types";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function actorKind(kind: "USER" | "SERVICE") {
  return kind === "USER" ? ActorKind.USER : ActorKind.SERVICE;
}

const configurationSelect = {
  id: true,
  externalId: true,
  accountId: true,
  schemaVersion: true,
  currentRevision: true,
  values: true,
  digest: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ApplicationConfigurationSelect;

const revisionSelect = {
  id: true,
  externalId: true,
  revision: true,
  schemaVersion: true,
  values: true,
  digest: true,
  source: true,
  reason: true,
  actorId: true,
  rolledBackFromRevision: true,
  createdAt: true,
} satisfies Prisma.ApplicationConfigurationRevisionSelect;

function view(row: {
  id: string;
  externalId: string;
  accountId: string;
  schemaVersion: number;
  currentRevision: number;
  values: Prisma.JsonValue;
  digest: string;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return Object.freeze({
    ...row,
    values: applicationConfigurationValuesSchema.parse(row.values),
  });
}

export class ConfigurationConflictError extends Error {
  constructor() {
    super("Application configuration changed while this request was open.");
    this.name = "ConfigurationConflictError";
  }
}

export class PrismaApplicationConfigurationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async current(accountId: string) {
    const row = await this.prisma.applicationConfiguration.findUnique({
      where: { accountId },
      select: configurationSelect,
    });
    return row ? view(row) : null;
  }

  async currentForActiveAccounts(limit = 5_000) {
    const rows = await this.prisma.applicationConfiguration.findMany({
      where: { account: { status: "ACTIVE" } },
      orderBy: { accountId: "asc" },
      take: limit,
      select: configurationSelect,
    });
    return rows.map(view);
  }

  async history(accountId: string, limit = 50) {
    const rows = await this.prisma.applicationConfigurationRevision.findMany({
      where: { accountId },
      orderBy: { revision: "desc" },
      take: limit,
      select: revisionSelect,
    });
    return rows.map((row) =>
      Object.freeze({
        ...row,
        values: applicationConfigurationValuesSchema.parse(row.values),
      }),
    );
  }

  seed(input: {
    accountId: string;
    values: ApplicationConfigurationValues;
    reason: string;
    actor: TrustedActorContext;
    seededAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1::integer
        FROM pg_advisory_xact_lock(hashtextextended(${`application-configuration:${input.accountId}`}, 0))
      `;
      const existing = await tx.applicationConfiguration.findUnique({
        where: { accountId: input.accountId },
        select: configurationSelect,
      });
      if (existing)
        return { created: false as const, configuration: view(existing) };

      const values = applicationConfigurationValuesSchema.parse(input.values);
      const digest = applicationConfigurationDigest(values);
      const configurationId = randomUUID();
      const revisionId = randomUUID();
      const created = await tx.applicationConfiguration.create({
        data: {
          id: configurationId,
          accountId: input.accountId,
          schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
          currentRevision: 1,
          values: json(values),
          digest,
          createdById: input.actor.appUserId,
          updatedById: input.actor.appUserId,
          createdAt: input.seededAt,
          updatedAt: input.seededAt,
        },
        select: configurationSelect,
      });
      await tx.applicationConfigurationRevision.create({
        data: {
          id: revisionId,
          accountId: input.accountId,
          configurationId,
          revision: 1,
          schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
          values: json(values),
          digest,
          source: ConfigurationRevisionSource.ENVIRONMENT_SEED,
          reason: input.reason,
          actorId: input.actor.actorId,
          actorUserId: input.actor.appUserId,
          createdAt: input.seededAt,
        },
      });
      await this.audit(tx, {
        accountId: input.accountId,
        configurationId,
        action: "application_configuration.seed",
        actor: input.actor,
        revision: 1,
        digest,
        categories: applicationConfigurationCategories,
      });
      return { created: true as const, configuration: view(created) };
    });
  }

  async save(input: {
    accountId: string;
    expectedRevision: number;
    values: ApplicationConfigurationValues;
    reason: string;
    actor: TrustedActorContext;
    savedAt: Date;
  }) {
    return this.write({
      ...input,
      source: ConfigurationRevisionSource.ADMIN_UPDATE,
      rolledBackFromRevision: null,
      action: "application_configuration.update",
    });
  }

  async rollback(input: {
    accountId: string;
    expectedRevision: number;
    targetRevision: number;
    reason: string;
    actor: TrustedActorContext;
    savedAt: Date;
  }) {
    const target = await this.prisma.applicationConfigurationRevision.findFirst(
      {
        where: {
          accountId: input.accountId,
          revision: input.targetRevision,
        },
        select: { values: true },
      },
    );
    if (!target) return null;
    return this.write({
      accountId: input.accountId,
      expectedRevision: input.expectedRevision,
      values: applicationConfigurationValuesSchema.parse(target.values),
      reason: input.reason,
      actor: input.actor,
      savedAt: input.savedAt,
      source: ConfigurationRevisionSource.ROLLBACK,
      rolledBackFromRevision: input.targetRevision,
      action: "application_configuration.rollback",
    });
  }

  private write(input: {
    accountId: string;
    expectedRevision: number;
    values: ApplicationConfigurationValues;
    reason: string;
    actor: TrustedActorContext;
    savedAt: Date;
    source: ConfigurationRevisionSource;
    rolledBackFromRevision: number | null;
    action: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1::integer
        FROM pg_advisory_xact_lock(hashtextextended(${`application-configuration:${input.accountId}`}, 0))
      `;
      const current = await tx.applicationConfiguration.findUnique({
        where: { accountId: input.accountId },
        select: configurationSelect,
      });
      if (!current) return null;
      if (current.currentRevision !== input.expectedRevision) {
        throw new ConfigurationConflictError();
      }
      const previous = await tx.applicationConfigurationRevision.findUnique({
        where: {
          configurationId_revision: {
            configurationId: current.id,
            revision: current.currentRevision,
          },
        },
        select: { id: true },
      });
      if (!previous) throw new ConfigurationConflictError();
      const before = applicationConfigurationValuesSchema.parse(current.values);
      const values = applicationConfigurationValuesSchema.parse(input.values);
      const digest = applicationConfigurationDigest(values);
      const revision = current.currentRevision + 1;
      await tx.applicationConfigurationRevision.create({
        data: {
          id: randomUUID(),
          accountId: input.accountId,
          configurationId: current.id,
          revision,
          schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
          values: json(values),
          digest,
          source: input.source,
          reason: input.reason,
          actorId: input.actor.actorId,
          actorUserId: input.actor.appUserId,
          previousRevisionId: previous.id,
          rolledBackFromRevision: input.rolledBackFromRevision,
          createdAt: input.savedAt,
        },
      });
      const updated = await tx.applicationConfiguration.updateMany({
        where: {
          id: current.id,
          accountId: input.accountId,
          currentRevision: input.expectedRevision,
        },
        data: {
          schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
          currentRevision: revision,
          values: json(values),
          digest,
          updatedById: input.actor.appUserId,
          updatedAt: input.savedAt,
        },
      });
      if (updated.count !== 1) throw new ConfigurationConflictError();
      const categories = applicationConfigurationChangedCategories(
        before,
        values,
      );
      await this.audit(tx, {
        accountId: input.accountId,
        configurationId: current.id,
        action: input.action,
        actor: input.actor,
        revision,
        digest,
        categories,
        rolledBackFromRevision: input.rolledBackFromRevision,
      });
      const refreshed = await tx.applicationConfiguration.findUniqueOrThrow({
        where: { id: current.id },
        select: configurationSelect,
      });
      return view(refreshed);
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      configurationId: string;
      action: string;
      actor: TrustedActorContext;
      revision: number;
      digest: string;
      categories: readonly string[];
      rolledBackFromRevision?: number | null;
    },
  ) {
    return tx.securityAuditRecord.create({
      data: {
        scope: AuditScope.ACCOUNT,
        accountId: input.accountId,
        actorKind: actorKind(input.actor.actorKind),
        actorId: input.actor.actorId,
        actorUserId: input.actor.actorUserId,
        action: input.action,
        capability: input.actor.capability,
        targetType: "ApplicationConfiguration",
        targetId: input.configurationId,
        outcome: AuditOutcome.SUCCEEDED,
        metadata: {
          schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
          revision: input.revision,
          digest: input.digest,
          changedCategories: [...input.categories],
          ...(input.rolledBackFromRevision
            ? { rolledBackFromRevision: input.rolledBackFromRevision }
            : {}),
        },
      },
    });
  }
}
