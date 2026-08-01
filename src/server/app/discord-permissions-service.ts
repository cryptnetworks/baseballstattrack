import {
  discordRoleGrantRevokeSchema,
  discordRoleGrantUpdateSchema,
} from "@/domain/discord-permissions";
import {
  getRateLimitService,
  noRateLimit,
  type RateLimitEnforcer,
} from "@/server/app/rate-limit-service";
import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type Capability,
  type TrustedActorContext,
} from "@/server/auth/types";
import {
  DiscordPermissionsConflictError,
  PrismaDiscordPermissionsRepository,
} from "@/server/data/discord-permissions-repository";
import { getPrismaClient } from "@/server/data/prisma";

type DiscordPermissionsRepository = Pick<
  PrismaDiscordPermissionsRepository,
  "listGrants" | "writeGrant" | "revokeGrant" | "listAuditHistory"
>;

export class DiscordPermissionsError extends Error {
  constructor(
    readonly code:
      "RESOURCE_UNAVAILABLE" | "REVISION_CONFLICT" | "MEMBERSHIP_STALE",
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DiscordPermissionsError";
  }
}

function accountActor(
  actorInput: TrustedActorContext,
  accountId: string,
  capability: Capability,
) {
  const actor = requireTrustedActor(actorInput, accountId, capability);
  if (actor.target.kind !== "ACCOUNT") {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  return actor;
}

export class DiscordPermissionsService {
  constructor(
    private readonly repository: DiscordPermissionsRepository,
    private readonly rateLimits: RateLimitEnforcer = noRateLimit,
  ) {}

  async list(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    accountActor(actorInput, accountId, "discord.settings.view");
    const result = await this.repository.listGrants(accountId, installationId);
    if (!result) {
      throw new DiscordPermissionsError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The Discord permission resource is unavailable.",
      );
    }
    return result;
  }

  async history(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    accountActor(actorInput, accountId, "discord.settings.operate");
    const result = await this.repository.listAuditHistory(
      accountId,
      installationId,
    );
    if (!result) {
      throw new DiscordPermissionsError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The Discord permission resource is unavailable.",
      );
    }
    return result;
  }

  async update(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordRoleGrantUpdateSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    return this.write(() => this.repository.writeGrant({ ...parsed, actor }));
  }

  async revoke(input: unknown, actorInput: TrustedActorContext) {
    const parsed = discordRoleGrantRevokeSchema.parse(input);
    const actor = accountActor(
      actorInput,
      parsed.accountId,
      "discord.settings.configure",
    );
    await this.rateLimits.enforce(
      { accountId: parsed.accountId, endpointClass: "ADMINISTRATION" },
      actor,
    );
    return this.write(() => this.repository.revokeGrant({ ...parsed, actor }));
  }

  private async write(
    operation: () => Promise<
      | { outcome: "updated"; grant: unknown }
      | { outcome: "unavailable" | "membership_stale" }
    >,
  ) {
    let result: Awaited<ReturnType<typeof operation>>;
    try {
      result = await operation();
    } catch (error) {
      if (error instanceof DiscordPermissionsConflictError) {
        throw new DiscordPermissionsError(
          "REVISION_CONFLICT",
          409,
          "The Discord permissions changed before this update was applied.",
        );
      }
      throw error;
    }
    if (result.outcome === "unavailable") {
      throw new DiscordPermissionsError(
        "RESOURCE_UNAVAILABLE",
        404,
        "The Discord permission resource is unavailable.",
      );
    }
    if (result.outcome === "membership_stale") {
      throw new DiscordPermissionsError(
        "MEMBERSHIP_STALE",
        403,
        "Discord membership must be verified again before permissions change.",
      );
    }
    if (result.outcome === "updated") return result.grant;
    throw new DiscordPermissionsError(
      "RESOURCE_UNAVAILABLE",
      404,
      "The Discord permission resource is unavailable.",
    );
  }
}

export function getDiscordPermissionsService() {
  return new DiscordPermissionsService(
    new PrismaDiscordPermissionsRepository(getPrismaClient()),
    getRateLimitService(),
  );
}
