import {
  ManagementError,
  addRosterPeriodCommandSchema,
  addTeamSeasonCommandSchema,
  assertScope,
  changeJerseyCommandSchema,
  createPlayerCommandSchema,
  createSeasonCommandSchema,
  createTeamCommandSchema,
  endRosterPeriodCommandSchema,
  namePageSchema,
  parseManagementInput,
  requireManagementActor,
  rosterHistoryPageSchema,
  setPlayerArchivedCommandSchema,
  setTeamArchivedCommandSchema,
  setTeamSeasonArchivedCommandSchema,
  transitionSeasonCommandSchema,
  updatePlayerCommandSchema,
  updateSeasonCommandSchema,
  updateTeamCommandSchema,
  type ManagementActorContext,
} from "@/domain/management/team-season-roster";
import { PrismaTeamSeasonRosterRepository } from "@/server/data/team-season-roster-repository";

function requireAccountScope(actor: ManagementActorContext): void {
  if (actor.scope.kind !== "ACCOUNT") {
    throw new ManagementError(
      "AUTHORIZATION_REQUIRED",
      "Account scope is required for this identity operation.",
    );
  }
}

function requireTarget<T extends { teamId: string; seasonId: string }>(
  target: T | null,
): T {
  if (target === null) {
    throw new ManagementError(
      "NOT_FOUND_OR_INACCESSIBLE",
      "Management resource is unavailable.",
    );
  }
  return target;
}

export class TeamSeasonRosterService {
  constructor(private readonly repository: PrismaTeamSeasonRosterRepository) {}

  async createTeam(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(createTeamCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "team.manage",
    );
    requireAccountScope(actor);
    return this.repository.createTeam(command, actor);
  }

  async updateTeam(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(updateTeamCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "team.manage",
    );
    assertScope(actor, { teamId: command.teamId });
    return this.repository.updateTeam(command, actor);
  }

  async setTeamArchived(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(setTeamArchivedCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "team.manage",
    );
    assertScope(actor, { teamId: command.teamId });
    return this.repository.setTeamArchived(command, actor);
  }

  async createSeason(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(createSeasonCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "season.manage",
    );
    requireAccountScope(actor);
    return this.repository.createSeason(command, actor);
  }

  async updateSeason(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(updateSeasonCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "season.manage",
    );
    assertScope(actor, { seasonId: command.seasonId });
    return this.repository.updateSeason(command, actor);
  }

  async transitionSeason(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(transitionSeasonCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "season.manage",
    );
    assertScope(actor, { seasonId: command.seasonId });
    return this.repository.transitionSeason(command, actor);
  }

  async addTeamSeason(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(addTeamSeasonCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "season.manage",
    );
    assertScope(actor, {
      teamId: command.teamId,
      seasonId: command.seasonId,
    });
    return this.repository.addTeamSeason(command, actor);
  }

  async setTeamSeasonArchived(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(
      setTeamSeasonArchivedCommandSchema,
      input,
    );
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "season.manage",
    );
    const target = requireTarget(
      await this.repository.getTeamSeasonScope(
        command.accountId,
        command.teamSeasonId,
      ),
    );
    assertScope(actor, target);
    return this.repository.setTeamSeasonArchived(command, actor);
  }

  async createPlayer(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(createPlayerCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "roster.manage",
    );
    requireAccountScope(actor);
    return this.repository.createPlayer(command, actor);
  }

  async updatePlayer(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(updatePlayerCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "roster.manage",
    );
    requireAccountScope(actor);
    return this.repository.updatePlayer(command, actor);
  }

  async setPlayerArchived(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(setPlayerArchivedCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "roster.manage",
    );
    requireAccountScope(actor);
    return this.repository.setPlayerArchived(command, actor);
  }

  async addRosterPeriod(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(addRosterPeriodCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "roster.manage",
    );
    const target = requireTarget(
      await this.repository.getTeamSeasonScope(
        command.accountId,
        command.teamSeasonId,
      ),
    );
    assertScope(actor, target);
    return this.repository.addRosterPeriod(command, actor);
  }

  async endRosterPeriod(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(endRosterPeriodCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "roster.manage",
    );
    const result = await this.repository.getRosterEntryScope(
      command.accountId,
      command.rosterEntryId,
    );
    const target = requireTarget(result?.teamSeason ?? null);
    assertScope(actor, target);
    return this.repository.endRosterPeriod(command, actor);
  }

  async changeJersey(input: unknown, actorInput: unknown) {
    const command = parseManagementInput(changeJerseyCommandSchema, input);
    const actor = requireManagementActor(
      actorInput,
      command.accountId,
      "roster.manage",
    );
    const result = await this.repository.getRosterEntryScope(
      command.accountId,
      command.rosterEntryId,
    );
    const target = requireTarget(result?.teamSeason ?? null);
    assertScope(actor, target);
    return this.repository.changeJersey(command, actor);
  }

  async listTeams(input: unknown, actorInput: unknown) {
    const page = parseManagementInput(namePageSchema, input);
    const actor = requireManagementActor(
      actorInput,
      page.accountId,
      "team.view",
    );
    return this.repository.listTeams(page, actor);
  }

  async listSeasons(input: unknown, actorInput: unknown) {
    const page = parseManagementInput(namePageSchema, input);
    const actor = requireManagementActor(
      actorInput,
      page.accountId,
      "season.view",
    );
    return this.repository.listSeasons(page, actor);
  }

  async listPlayers(input: unknown, actorInput: unknown) {
    const page = parseManagementInput(namePageSchema, input);
    const actor = requireManagementActor(
      actorInput,
      page.accountId,
      "roster.view",
    );
    return this.repository.listPlayers(page, actor);
  }

  async listRosterHistory(input: unknown, actorInput: unknown) {
    const page = parseManagementInput(rosterHistoryPageSchema, input);
    const actor = requireManagementActor(
      actorInput,
      page.accountId,
      "roster.view",
    );
    return this.repository.listRosterHistory(page, actor);
  }
}
