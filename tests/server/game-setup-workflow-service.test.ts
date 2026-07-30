import { describe, expect, it, vi } from "vitest";

import { GameSetupService } from "@/server/app/game-setup-service";
import type { PrismaGameSetupRepository } from "@/server/data/game-setup-repository";
import { trustedActorForTest } from "../fixtures/trusted-actor";

const actor = (
  input:
    | {
        accountId: string;
        capability: "game.create";
        scope: { kind: "ACCOUNT" } | { kind: "TEAM"; teamId: string };
      }
    | {
        accountId: string;
        capability: "game.setup";
        scope: { kind: "GAME"; gameId: string };
      },
) =>
  trustedActorForTest({
    ...input,
    actorId: "setup-service",
    actorKind: "SERVICE",
    actorUserId: null,
    authorizedAt: "2026-07-30T00:00:00.000Z",
  });

describe("game setup workflow application queries", () => {
  it("loads creation choices only from an Account-scoped game.create actor", async () => {
    const loadCreationContext = vi.fn().mockResolvedValue({
      teamSeasons: [],
      rulesets: [],
      games: [],
    });
    const service = new GameSetupService({
      loadCreationContext,
    } as unknown as PrismaGameSetupRepository);
    const creationActor = actor({
      accountId: "account-a",
      capability: "game.create",
      scope: { kind: "ACCOUNT" },
    });
    await expect(
      service.loadCreationContext({ accountId: "account-a" }, creationActor),
    ).resolves.toEqual({ teamSeasons: [], rulesets: [], games: [] });
    expect(loadCreationContext).toHaveBeenCalledWith({
      accountId: "account-a",
    });
  });

  it("fails closed for cross-Account or narrower creation contexts", async () => {
    const loadCreationContext = vi.fn();
    const service = new GameSetupService({
      loadCreationContext,
    } as unknown as PrismaGameSetupRepository);
    await expect(
      service.loadCreationContext(
        { accountId: "account-b" },
        actor({
          accountId: "account-a",
          capability: "game.create",
          scope: { kind: "ACCOUNT" },
        }),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    await expect(
      service.loadCreationContext(
        { accountId: "account-a" },
        actor({
          accountId: "account-a",
          capability: "game.create",
          scope: { kind: "TEAM", teamId: "team-a" },
        }),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(loadCreationContext).not.toHaveBeenCalled();
  });

  it("requires the exact Game scope for resumable workflow data", async () => {
    const loadWorkflowContext = vi.fn().mockResolvedValue({ game: "game-a" });
    const service = new GameSetupService({
      loadWorkflowContext,
    } as unknown as PrismaGameSetupRepository);
    const workflowActor = actor({
      accountId: "account-a",
      capability: "game.setup",
      scope: { kind: "GAME", gameId: "game-a" },
    });
    await expect(
      service.loadWorkflowContext(
        { accountId: "account-a", gameId: "game-a" },
        workflowActor,
      ),
    ).resolves.toEqual({ game: "game-a" });
    await expect(
      service.loadWorkflowContext(
        { accountId: "account-a", gameId: "game-b" },
        workflowActor,
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(loadWorkflowContext).toHaveBeenCalledTimes(1);
  });
});
