import { AuthorizationError } from "@/server/auth/errors";
import {
  requireTrustedActor,
  type TrustedActorContext,
} from "@/server/auth/types";
import { PrismaDiscordActivityRepository } from "@/server/data/discord-activity-repository";
import { getPrismaClient } from "@/server/data/prisma";

type DiscordActivityRepository = Pick<
  PrismaDiscordActivityRepository,
  "getWorkspace"
>;

export class DiscordActivityError extends Error {
  constructor() {
    super("The Discord activity resource is unavailable.");
    this.name = "DiscordActivityError";
  }
}

export class DiscordActivityService {
  constructor(private readonly repository: DiscordActivityRepository) {}

  async get(
    accountId: string,
    installationId: string,
    actorInput: TrustedActorContext,
  ) {
    const actor = requireTrustedActor(
      actorInput,
      accountId,
      "discord.settings.operate",
    );
    if (actor.target.kind !== "ACCOUNT") {
      throw new AuthorizationError("AUTHORIZATION_REQUIRED");
    }
    const workspace = await this.repository.getWorkspace(
      accountId,
      installationId,
    );
    if (!workspace) throw new DiscordActivityError();
    return workspace;
  }
}

export function getDiscordActivityService() {
  return new DiscordActivityService(
    new PrismaDiscordActivityRepository(getPrismaClient()),
  );
}
