import {
  GameSetupError,
  assertGameCreateScope,
  assertGameScope,
  createDraftGameCommandSchema,
  loadCurrentSetupQuerySchema,
  markSetupReadyCommandSchema,
  parseGameSetupInput,
  requireGameSetupActor,
  rosterCandidatePageSchema,
  saveSetupRevisionCommandSchema,
} from "@/domain/setup/game-setup";
import { PrismaGameSetupRepository } from "@/server/data/game-setup-repository";

export class GameSetupService {
  constructor(private readonly repository: PrismaGameSetupRepository) {}

  async createDraftGame(input: unknown, actorInput: unknown) {
    const command = parseGameSetupInput(createDraftGameCommandSchema, input);
    const actor = requireGameSetupActor(
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

  async saveSetupRevision(input: unknown, actorInput: unknown) {
    const command = parseGameSetupInput(saveSetupRevisionCommandSchema, input);
    const actor = requireGameSetupActor(
      actorInput,
      command.accountId,
      "game.setup",
    );
    assertGameScope(actor, command.gameId);
    return this.repository.saveSetupRevision(command, actor);
  }

  async markSetupReady(input: unknown, actorInput: unknown) {
    const command = parseGameSetupInput(markSetupReadyCommandSchema, input);
    const actor = requireGameSetupActor(
      actorInput,
      command.accountId,
      "game.setup",
    );
    assertGameScope(actor, command.gameId);
    return this.repository.markSetupReady(command, actor);
  }

  async loadCurrentSetup(input: unknown, actorInput: unknown) {
    const query = parseGameSetupInput(loadCurrentSetupQuerySchema, input);
    const actor = requireGameSetupActor(
      actorInput,
      query.accountId,
      "game.view",
    );
    assertGameScope(actor, query.gameId);
    return this.repository.loadCurrentSetup(query);
  }

  async listRosterCandidates(input: unknown, actorInput: unknown) {
    const page = parseGameSetupInput(rosterCandidatePageSchema, input);
    const actor = requireGameSetupActor(
      actorInput,
      page.accountId,
      "game.setup",
    );
    assertGameScope(actor, page.gameId);
    return this.repository.listRosterCandidates(page);
  }
}
