import {
  GameSetupError,
  assertGameCreateScope,
  assertGameScope,
  createDraftGameCommandSchema,
  gameSetupCreationContextQuerySchema,
  gameSetupWorkflowContextQuerySchema,
  loadCurrentSetupQuerySchema,
  markSetupReadyCommandSchema,
  parseGameSetupInput,
  rosterCandidatePageSchema,
  saveSetupRevisionCommandSchema,
} from "@/domain/setup/game-setup";
import { toGameSetupActor } from "@/server/auth/trusted-actor-adapters";
import type { TrustedActorContext } from "@/server/auth/types";
import { requireTrustedActor } from "@/server/auth/types";
import { PrismaGameSetupRepository } from "@/server/data/game-setup-repository";
import { getPrismaClient } from "@/server/data/prisma";

export class GameSetupService {
  constructor(private readonly repository: PrismaGameSetupRepository) {}

  async createDraftGame(input: unknown, actorInput: TrustedActorContext) {
    const command = parseGameSetupInput(createDraftGameCommandSchema, input);
    const actor = toGameSetupActor(
      actorInput,
      command.accountId,
      "game.create",
    );
    const target = await this.repository.getTeamSeasonTarget(
      command.accountId,
      command.managedTeamSeasonId,
    );
    if (!target || target.seasonId !== command.seasonId) {
      throw new GameSetupError(
        "NOT_FOUND_OR_INACCESSIBLE",
        "Managed team-season is unavailable.",
      );
    }
    assertGameCreateScope(actor, target);
    return this.repository.createDraftGame(command, actor);
  }

  async saveSetupRevision(input: unknown, actorInput: TrustedActorContext) {
    const command = parseGameSetupInput(saveSetupRevisionCommandSchema, input);
    const actor = toGameSetupActor(actorInput, command.accountId, "game.setup");
    assertGameScope(actor, command.gameId);
    return this.repository.saveSetupRevision(command, actor);
  }

  async markSetupReady(input: unknown, actorInput: TrustedActorContext) {
    const command = parseGameSetupInput(markSetupReadyCommandSchema, input);
    const actor = toGameSetupActor(actorInput, command.accountId, "game.setup");
    assertGameScope(actor, command.gameId);
    return this.repository.markSetupReady(command, actor);
  }

  async loadCurrentSetup(input: unknown, actorInput: TrustedActorContext) {
    const query = parseGameSetupInput(loadCurrentSetupQuerySchema, input);
    const actor = toGameSetupActor(actorInput, query.accountId, "game.view");
    assertGameScope(actor, query.gameId);
    return this.repository.loadCurrentSetup(query);
  }

  async listRosterCandidates(input: unknown, actorInput: TrustedActorContext) {
    const page = parseGameSetupInput(rosterCandidatePageSchema, input);
    const actor = toGameSetupActor(actorInput, page.accountId, "game.setup");
    assertGameScope(actor, page.gameId);
    return this.repository.listRosterCandidates(page);
  }

  async loadCreationContext(input: unknown, actorInput: TrustedActorContext) {
    const query = parseGameSetupInput(
      gameSetupCreationContextQuerySchema,
      input,
    );
    const actor = requireTrustedActor(
      actorInput,
      query.accountId,
      "game.create",
    );
    if (actor.target.kind !== "ACCOUNT") {
      throw new GameSetupError(
        "AUTHORIZATION_REQUIRED",
        "Account scope is required to list game setup choices.",
      );
    }
    return this.repository.loadCreationContext(query);
  }

  async loadWorkflowContext(input: unknown, actorInput: TrustedActorContext) {
    const query = parseGameSetupInput(
      gameSetupWorkflowContextQuerySchema,
      input,
    );
    const actor = requireTrustedActor(
      actorInput,
      query.accountId,
      "game.setup",
    );
    if (actor.target.kind !== "GAME" || actor.target.gameId !== query.gameId) {
      throw new GameSetupError(
        "AUTHORIZATION_REQUIRED",
        "Exact Game scope is required.",
      );
    }
    return this.repository.loadWorkflowContext(query);
  }
}

export function getGameSetupService() {
  return new GameSetupService(new PrismaGameSetupRepository(getPrismaClient()));
}
