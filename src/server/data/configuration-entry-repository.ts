import {
  Prisma,
  type ConfigurationCategory,
  type ConfigurationScope,
  type ConfigurationVisibility,
  type PrismaClient,
  type SecretReferenceProvider,
} from "@prisma/client";

import {
  configurationEntrySchema,
  type ConfigurationEntry,
} from "@/domain/configuration-entry";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function view(row: {
  id?: string;
  key: string;
  category: ConfigurationCategory;
  scope: ConfigurationScope;
  accountId: string | null;
  ownerId: string | null;
  visibility: ConfigurationVisibility;
  value: Prisma.JsonValue | null;
  secretReference: {
    provider: SecretReferenceProvider;
    referenceIdentifier: string;
    environment: string;
    rotationMetadata: Prisma.JsonValue | null;
    lastRotatedAt: Date | null;
  } | null;
}) {
  const { id, ...fields } = row;
  void id;
  return configurationEntrySchema.parse({
    ...fields,
    value: row.value,
    secretReference: row.secretReference
      ? {
          provider: row.secretReference.provider,
          referenceIdentifier: row.secretReference.referenceIdentifier,
          environment: row.secretReference.environment,
          ...(row.secretReference.rotationMetadata
            ? { rotationMetadata: row.secretReference.rotationMetadata }
            : {}),
          lastRotatedAt:
            row.secretReference.lastRotatedAt?.toISOString() ?? null,
        }
      : null,
  });
}

const select = {
  id: true,
  key: true,
  category: true,
  scope: true,
  accountId: true,
  ownerId: true,
  visibility: true,
  value: true,
  secretReference: {
    select: {
      provider: true,
      referenceIdentifier: true,
      environment: true,
      rotationMetadata: true,
      lastRotatedAt: true,
    },
  },
} satisfies Prisma.ConfigurationEntrySelect;

export class PrismaConfigurationEntryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: { scope: ConfigurationScope; accountId?: string | null }) {
    const rows = await this.prisma.configurationEntry.findMany({
      where: {
        scope: input.scope,
        accountId: input.accountId ?? null,
      },
      orderBy: [{ category: "asc" }, { key: "asc" }],
      select,
    });
    return rows.map(view);
  }

  async put(input: ConfigurationEntry) {
    const parsed = configurationEntrySchema.parse(input);
    return this.prisma.$transaction(async (tx) => {
      const secretReference = parsed.secretReference
        ? await tx.secretReference.upsert({
            where: {
              provider_referenceIdentifier_environment: {
                provider: parsed.secretReference.provider,
                referenceIdentifier: parsed.secretReference.referenceIdentifier,
                environment: parsed.secretReference.environment,
              },
            },
            create: {
              provider: parsed.secretReference.provider,
              referenceIdentifier: parsed.secretReference.referenceIdentifier,
              environment: parsed.secretReference.environment,
              rotationMetadata: parsed.secretReference.rotationMetadata
                ? json(parsed.secretReference.rotationMetadata)
                : Prisma.DbNull,
              lastRotatedAt: parsed.secretReference.lastRotatedAt
                ? new Date(parsed.secretReference.lastRotatedAt)
                : null,
            },
            update: {
              rotationMetadata: parsed.secretReference.rotationMetadata
                ? json(parsed.secretReference.rotationMetadata)
                : Prisma.DbNull,
              lastRotatedAt: parsed.secretReference.lastRotatedAt
                ? new Date(parsed.secretReference.lastRotatedAt)
                : null,
            },
            select: { id: true },
          })
        : null;
      const existing = await tx.configurationEntry.findFirst({
        where: {
          scope: parsed.scope,
          accountId: parsed.accountId,
          key: parsed.key,
        },
        select: { id: true },
      });
      const data = {
        key: parsed.key,
        category: parsed.category,
        scope: parsed.scope,
        accountId: parsed.accountId,
        ownerId: parsed.ownerId,
        visibility: parsed.visibility,
        value: parsed.value === null ? Prisma.DbNull : json(parsed.value),
        secretReferenceId: secretReference?.id ?? null,
      } satisfies Prisma.ConfigurationEntryUncheckedCreateInput;
      const saved = existing
        ? await tx.configurationEntry.update({
            where: { id: existing.id },
            data,
            select,
          })
        : await tx.configurationEntry.create({ data, select });
      const row = await tx.configurationEntry.findUniqueOrThrow({
        where: { id: saved.id },
        select,
      });
      return view(row);
    });
  }
}
