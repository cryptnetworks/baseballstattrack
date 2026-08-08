import { z } from "zod";

import {
  DEFAULT_APPLICATION_CONFIGURATION,
  applicationConfigurationChangedCategories,
  applicationConfigurationDigest,
  applicationConfigurationValuesSchema,
  applicationConfigurationCategories,
  configurationWriteSchema,
  type ApplicationConfigurationValues,
} from "@/domain/application-configuration";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import { configurationSeedFromEnvironment } from "@/server/config/configuration-seed";
import {
  ConfigurationConflictError,
  PrismaApplicationConfigurationRepository,
} from "@/server/data/application-configuration-repository";
import { getPrismaClient } from "@/server/data/prisma";

const accountIdSchema = z.string().trim().min(1).max(128);
const cacheTtlMs = 30_000;

type Repository = Pick<
  PrismaApplicationConfigurationRepository,
  | "current"
  | "currentForActiveAccounts"
  | "history"
  | "seed"
  | "save"
  | "rollback"
>;

type CacheEntry = Readonly<{
  revision: number;
  values: ApplicationConfigurationValues;
  expiresAt: number;
}>;

export class ApplicationConfigurationError extends Error {
  constructor(
    readonly code: "NOT_CONFIGURED" | "NOT_FOUND" | "NO_CHANGES" | "CONFLICT",
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationConfigurationError";
  }
}

function administrator(
  actorInput: TrustedActorContext,
  accountId: string,
  capability: "configuration.view" | "configuration.manage",
) {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "ACCOUNT" || actor.actorKind !== "USER") {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor;
}

export class ApplicationConfigurationService {
  private readonly cache = new Map<string, CacheEntry>();
  private preloadExpiresAt = 0;
  private preloadLoaded = 0;
  private preloadPromise: Promise<{ loaded: number }> | null = null;

  constructor(
    private readonly repository: Repository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runtime(accountIdInput: string, forceRefresh = false) {
    const accountId = accountIdSchema.parse(accountIdInput);
    const time = this.now().getTime();
    const cached = this.cache.get(accountId);
    if (!forceRefresh && cached && cached.expiresAt > time) return cached;
    const current = await this.repository.current(accountId);
    const entry = Object.freeze({
      revision: current?.currentRevision ?? 0,
      values: current?.values ?? DEFAULT_APPLICATION_CONFIGURATION,
      expiresAt: time + cacheTtlMs,
    });
    this.cache.set(accountId, entry);
    return entry;
  }

  async preload() {
    const time = this.now().getTime();
    if (this.preloadExpiresAt > time) return { loaded: this.preloadLoaded };
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      const rows = await this.repository.currentForActiveAccounts();
      const expiresAt = this.now().getTime() + cacheTtlMs;
      for (const row of rows) {
        this.cache.set(
          row.accountId,
          Object.freeze({
            revision: row.currentRevision,
            values: row.values,
            expiresAt,
          }),
        );
      }
      this.preloadExpiresAt = expiresAt;
      this.preloadLoaded = rows.length;
      return { loaded: rows.length };
    })();
    try {
      return await this.preloadPromise;
    } finally {
      this.preloadPromise = null;
    }
  }

  invalidate(accountId: string) {
    this.cache.delete(accountIdSchema.parse(accountId));
  }

  async refresh(accountId: string) {
    this.invalidate(accountId);
    return this.runtime(accountId, true);
  }

  async view(accountIdInput: string, actorInput: TrustedActorContext) {
    const accountId = accountIdSchema.parse(accountIdInput);
    administrator(actorInput, accountId, "configuration.view");
    const [current, history] = await Promise.all([
      this.repository.current(accountId),
      this.repository.history(accountId),
    ]);
    return {
      current,
      history,
      categories: applicationConfigurationCategories,
      defaults: DEFAULT_APPLICATION_CONFIGURATION,
    };
  }

  preview(inputValue: unknown, actorInput: TrustedActorContext) {
    const input = configurationWriteSchema.parse(inputValue);
    administrator(actorInput, input.accountId, "configuration.manage");
    return this.repository.current(input.accountId).then((current) => {
      if ((current?.currentRevision ?? 0) !== input.expectedRevision) {
        throw new ApplicationConfigurationError(
          "CONFLICT",
          409,
          "Reload the configuration before previewing.",
        );
      }
      const before = current?.values ?? DEFAULT_APPLICATION_CONFIGURATION;
      const changedCategories = applicationConfigurationChangedCategories(
        before,
        input.values,
      );
      return Object.freeze({
        expectedRevision: input.expectedRevision,
        nextRevision: input.expectedRevision + 1,
        changedCategories,
        digest: applicationConfigurationDigest(input.values),
        valid: true as const,
      });
    });
  }

  async seedFromEnvironment(
    inputValue: unknown,
    actorInput: TrustedActorContext,
    environment?: Readonly<Record<string, string | undefined>>,
  ) {
    const input = z
      .object({
        accountId: accountIdSchema,
        reason: z.string().trim().min(8).max(240),
      })
      .strict()
      .parse(inputValue);
    const actor = administrator(
      actorInput,
      input.accountId,
      "configuration.manage",
    );
    const result = await this.repository.seed({
      ...input,
      values: configurationSeedFromEnvironment(environment),
      actor,
      seededAt: this.now(),
    });
    this.invalidate(input.accountId);
    return result;
  }

  async seedInitial(inputValue: unknown, actorInput: TrustedActorContext) {
    const input = z
      .object({
        accountId: accountIdSchema,
        reason: z.string().trim().min(8).max(240),
        values: applicationConfigurationValuesSchema,
      })
      .strict()
      .parse(inputValue);
    const actor = administrator(
      actorInput,
      input.accountId,
      "configuration.manage",
    );
    const result = await this.repository.seed({
      ...input,
      actor,
      seededAt: this.now(),
    });
    this.invalidate(input.accountId);
    return result;
  }

  async save(inputValue: unknown, actorInput: TrustedActorContext) {
    const input = configurationWriteSchema.parse(inputValue);
    const actor = administrator(
      actorInput,
      input.accountId,
      "configuration.manage",
    );
    const current = await this.repository.current(input.accountId);
    if (!current) {
      throw new ApplicationConfigurationError(
        "NOT_CONFIGURED",
        409,
        "Seed the Account configuration before saving changes.",
      );
    }
    if (current.currentRevision !== input.expectedRevision) {
      throw new ApplicationConfigurationError(
        "CONFLICT",
        409,
        "Reload the configuration before saving.",
      );
    }
    if (
      applicationConfigurationDigest(current.values) ===
      applicationConfigurationDigest(input.values)
    ) {
      throw new ApplicationConfigurationError(
        "NO_CHANGES",
        409,
        "No configuration values changed.",
      );
    }
    try {
      const saved = await this.repository.save({
        ...input,
        actor,
        savedAt: this.now(),
      });
      if (!saved) {
        throw new ApplicationConfigurationError(
          "NOT_CONFIGURED",
          409,
          "Seed the Account configuration before saving changes.",
        );
      }
      this.invalidate(input.accountId);
      return saved;
    } catch (error) {
      if (error instanceof ConfigurationConflictError) {
        throw new ApplicationConfigurationError(
          "CONFLICT",
          409,
          "Reload the configuration before saving.",
        );
      }
      throw error;
    }
  }

  async rollback(inputValue: unknown, actorInput: TrustedActorContext) {
    const input = z
      .object({
        accountId: accountIdSchema,
        expectedRevision: z.int().positive(),
        targetRevision: z.int().positive(),
        reason: z.string().trim().min(8).max(240),
      })
      .strict()
      .refine((value) => value.targetRevision < value.expectedRevision, {
        path: ["targetRevision"],
        message: "Rollback must select an earlier revision.",
      })
      .parse(inputValue);
    const actor = administrator(
      actorInput,
      input.accountId,
      "configuration.manage",
    );
    try {
      const saved = await this.repository.rollback({
        ...input,
        actor,
        savedAt: this.now(),
      });
      if (!saved) {
        throw new ApplicationConfigurationError(
          "NOT_FOUND",
          404,
          "The requested configuration revision is unavailable.",
        );
      }
      this.invalidate(input.accountId);
      return saved;
    } catch (error) {
      if (error instanceof ConfigurationConflictError) {
        throw new ApplicationConfigurationError(
          "CONFLICT",
          409,
          "Reload the configuration before rolling back.",
        );
      }
      throw error;
    }
  }

  parseValues(input: unknown) {
    return applicationConfigurationValuesSchema.parse(input);
  }
}

let singleton: ApplicationConfigurationService | undefined;

export function getApplicationConfigurationService() {
  singleton ??= new ApplicationConfigurationService(
    new PrismaApplicationConfigurationRepository(getPrismaClient()),
  );
  return singleton;
}
