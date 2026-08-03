import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  normalizeExternalRecord,
  type ExternalProviderAdapter,
} from "@/domain/external-data";
import { getApplicationConfigurationService } from "@/server/app/application-configuration-service";
import {
  deploymentConfiguration,
  runtimeSecretConfiguration,
} from "@/server/config/runtime-environment";
import { getPrismaClient } from "@/server/data/prisma";
import { PrismaExternalIngestionRepository } from "@/server/data/external-ingestion-repository";
import { LicensedJsonFeedProvider } from "@/server/providers/licensed-json-feed";
import {
  emitOperationalEvent,
  getOperationalEventSink,
  type OperationalEventSink,
} from "@/server/observability/operational-events";

const externalId = z.uuid();
const safeKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);

type Repository = Pick<
  PrismaExternalIngestionRepository,
  | "source"
  | "startRun"
  | "storeRecord"
  | "quarantineInvalid"
  | "completePage"
  | "succeed"
  | "fail"
  | "listPublished"
>;

export class ExternalIngestionError extends Error {
  constructor(
    readonly code:
      | "SOURCE_UNAVAILABLE"
      | "SOURCE_NOT_APPROVED"
      | "SOURCE_NOT_DUE"
      | "PROVIDER_UNAVAILABLE"
      | "PAGE_LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "ExternalIngestionError";
  }
}

function safeFailureCode(error: unknown) {
  return error instanceof ExternalIngestionError
    ? error.code
    : error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.message)
      ? error.message
      : "PROVIDER_FAILURE";
}

export class ExternalIngestionService {
  constructor(
    private readonly repository: Repository,
    private readonly adapters: ReadonlyMap<string, ExternalProviderAdapter>,
    private readonly events: OperationalEventSink = getOperationalEventSink(),
  ) {}

  async run(input: {
    accountId: string;
    sourceExternalId: string;
    runKey: string;
    mode: "SCHEDULED" | "BACKFILL";
    from: Date;
    to: Date;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    safeKey.parse(input.accountId);
    externalId.parse(input.sourceExternalId);
    safeKey.parse(input.runKey);
    if (!(input.from < input.to) || input.to > now) {
      throw new ExternalIngestionError(
        "PROVIDER_UNAVAILABLE",
        "Invalid ingestion window.",
      );
    }
    const source = await this.repository.source(
      input.accountId,
      input.sourceExternalId,
    );
    if (!source || source.status !== "ACTIVE") {
      throw new ExternalIngestionError(
        "SOURCE_UNAVAILABLE",
        "Source unavailable.",
      );
    }
    if (
      !source.approvalReference ||
      !/^APPROVED:[A-Z0-9][A-Z0-9._:-]{7,127}$/u.test(
        source.approvalReference,
      ) ||
      !source.termsVersion?.trim() ||
      !source.attribution?.trim()
    ) {
      throw new ExternalIngestionError(
        "SOURCE_NOT_APPROVED",
        "Provider approval is missing.",
      );
    }
    if (source.nextAttemptAt && source.nextAttemptAt > now) {
      throw new ExternalIngestionError(
        "SOURCE_NOT_DUE",
        "Provider retry is not due.",
      );
    }
    const adapter = this.adapters.get(source.providerKey);
    if (!adapter || adapter.contract.key !== source.providerKey) {
      throw new ExternalIngestionError(
        "PROVIDER_UNAVAILABLE",
        "Provider adapter unavailable.",
      );
    }
    if (
      adapter.contract.authentication === "FIXTURE_ONLY" &&
      deploymentConfiguration().nodeEnvironment === "production"
    ) {
      throw new ExternalIngestionError(
        "SOURCE_NOT_APPROVED",
        "Fixture provider is disabled.",
      );
    }
    if (source.cadenceSeconds < adapter.contract.minimumCadenceSeconds) {
      throw new ExternalIngestionError(
        "SOURCE_NOT_APPROVED",
        "Configured cadence exceeds approval.",
      );
    }
    const started = await this.repository.startRun({
      accountId: input.accountId,
      sourceId: source.id,
      runKey: input.runKey,
      mode: input.mode,
      from: input.from,
      to: input.to,
      checkpoint: source.checkpoint
        ? (source.checkpoint as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    });
    if (started.idempotent) return { run: started.run, idempotent: true };
    let cursor: string | null = null;
    let checkpoint: Prisma.InputJsonValue = {};
    let quotaRemaining: number | null = null;
    let quotaResetAt: Date | null = null;
    const seen = new Set<string>();
    try {
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const page = await adapter.fetchPage({
          cursor,
          from: input.from,
          to: input.to,
          checkpoint: source.checkpoint,
        });
        let published = 0;
        let quarantined = 0;
        for (const rawRecord of page.records) {
          try {
            const record = normalizeExternalRecord(
              adapter.normalize(rawRecord),
            );
            const stored = await this.repository.storeRecord({
              accountId: input.accountId,
              sourceId: source.id,
              runId: started.run.id,
              record,
              retrievedAt: now,
            });
            if (!stored.duplicate && stored.status === "PUBLISHED")
              published += 1;
            if (!stored.duplicate && stored.status === "QUARANTINED")
              quarantined += 1;
          } catch {
            await this.repository.quarantineInvalid({
              accountId: input.accountId,
              sourceId: source.id,
              runId: started.run.id,
              providerVersion: page.providerVersion,
              rawRecord,
              retrievedAt: now,
            });
            quarantined += 1;
          }
        }
        await this.repository.completePage({
          runId: started.run.id,
          pageRecords: page.records.length,
          published,
          quarantined,
        });
        checkpoint = page.checkpoint as Prisma.InputJsonValue;
        quotaRemaining = page.quotaRemaining;
        quotaResetAt = page.quotaResetAt ? new Date(page.quotaResetAt) : null;
        if (page.nextCursor === null) break;
        if (seen.has(page.nextCursor)) throw new Error("PROVIDER_CURSOR_CYCLE");
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
        if (pageNumber === 99) {
          throw new ExternalIngestionError(
            "PAGE_LIMIT_EXCEEDED",
            "Provider page limit exceeded.",
          );
        }
      }
      await this.repository.succeed({
        sourceId: source.id,
        runId: started.run.id,
        checkpoint,
        completedAt: now,
        quotaRemaining,
        quotaResetAt,
      });
      emitOperationalEvent(this.events, {
        severity: "info",
        category: "background_job",
        name: "external_data_ingestion",
        outcome: "succeeded",
        accountId: input.accountId,
        metadata: { provider: source.providerKey },
      });
      return { runId: started.run.id, idempotent: false };
    } catch (error) {
      const code = safeFailureCode(error);
      await this.repository.fail({
        sourceId: source.id,
        runId: started.run.id,
        failureCode: code,
        failedAt: now,
        priorFailures: source.consecutiveFailures,
      });
      emitOperationalEvent(this.events, {
        severity: "warning",
        category: "background_job",
        name: "external_data_ingestion",
        outcome: "failed",
        accountId: input.accountId,
        code,
        metadata: { provider: source.providerKey },
      });
      throw error;
    }
  }
}

export async function getExternalIngestionService(accountId: string) {
  const adapters = new Map<string, ExternalProviderAdapter>();
  const configuration =
    await getApplicationConfigurationService().runtime(accountId);
  const baseUrl = configuration.values.integrations.externalDataProviderBaseUrl;
  const apiKey = runtimeSecretConfiguration().externalDataProviderApiKey;
  const allowedOrigin =
    deploymentConfiguration().externalDataProviderAllowedOrigin;
  if (baseUrl && apiKey) {
    if (!allowedOrigin) {
      throw new Error("Licensed provider credential origin is not configured.");
    }
    const provider = new LicensedJsonFeedProvider(
      baseUrl,
      apiKey,
      allowedOrigin,
    );
    adapters.set(provider.contract.key, provider);
  }
  return new ExternalIngestionService(
    new PrismaExternalIngestionRepository(getPrismaClient()),
    adapters,
  );
}
