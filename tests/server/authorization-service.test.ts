import type { MembershipRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { AuthorizationService } from "@/server/auth/authorization-service";
import { authorityPermits } from "@/server/auth/capability-policy";
import { requireSameOrigin } from "@/server/auth/request-security";
import type { AuthorizationStore } from "@/server/auth/store";
import {
  AUTH_PROVIDER,
  requireTrustedActor,
  type ActiveAuthority,
  type AuthenticatedIdentity,
  type AuthorityAssignment,
  type ResolvedTarget,
  type ResourceTarget,
} from "@/server/auth/types";

const identity: AuthenticatedIdentity = {
  provider: AUTH_PROVIDER,
  providerSubject: "provider-user-a",
};

const game: ResolvedTarget = {
  kind: "GAME",
  accountId: "account-a",
  teamIds: ["team-a"],
  seasonId: "season-a",
  gameId: "game-a",
};

const role = (
  value: MembershipRole,
  scope: AuthorityAssignment["scope"],
  target: Partial<AuthorityAssignment> = {},
): AuthorityAssignment => ({
  id: `role-${value}-${scope}`,
  source: "ROLE",
  role: value,
  capability: null,
  scope,
  teamId: null,
  seasonId: null,
  gameId: null,
  ...target,
});

const grant = (
  capability: string,
  scope: AuthorityAssignment["scope"],
  target: Partial<AuthorityAssignment> = {},
): AuthorityAssignment => ({
  id: `grant-${capability}-${scope}`,
  source: "GRANT",
  role: null,
  capability,
  scope,
  teamId: null,
  seasonId: null,
  gameId: null,
  ...target,
});

class MutableStore implements AuthorizationStore {
  userActive = true;
  authority: ActiveAuthority | null = {
    appUserId: "user-a",
    membershipId: "membership-a",
    accountId: "account-a",
    assignments: [role("SCOREKEEPER", "GAME", { gameId: "game-a" })],
  };
  targets = new Map<string, ResolvedTarget>([["GAME:game-a", game]]);

  async resolveOrProvisionUser() {
    return { id: "user-a", active: this.userActive };
  }

  async listAvailableAccounts() {
    return [
      {
        id: "account-a",
        externalId: "00000000-0000-4000-8000-000000000001",
        slug: "a",
        displayName: "Account A",
      },
    ];
  }

  async loadActiveAuthority(_userId: string, accountId: string) {
    return this.authority?.accountId === accountId ? this.authority : null;
  }

  async resolveTarget(target: ResourceTarget) {
    if (target.kind === "ACCOUNT") {
      return target.accountId === "account-a"
        ? {
            kind: "ACCOUNT" as const,
            accountId: "account-a",
            teamIds: [],
            seasonId: null,
            gameId: null,
          }
        : null;
    }
    const id =
      target.kind === "TEAM"
        ? target.teamId
        : target.kind === "SEASON"
          ? target.seasonId
          : target.gameId;
    return this.targets.get(`${target.kind}:${id}`) ?? null;
  }
}

describe("production authorization boundary", () => {
  it("derives a trusted actor from provider identity and current authority", async () => {
    const service = new AuthorizationService(new MutableStore());
    const actor = await service.authorize(
      identity,
      { kind: "GAME", accountId: "account-a", gameId: "game-a" },
      "game.score",
    );
    expect(actor).toMatchObject({
      appUserId: "user-a",
      membershipId: "membership-a",
      accountId: "account-a",
      capability: "game.score",
    });
    expect(requireTrustedActor(actor, "account-a", "game.score")).toBe(actor);
  });

  it("rejects a browser-fabricated actor even when every visible field matches", async () => {
    const actor = await new AuthorizationService(new MutableStore()).authorize(
      identity,
      { kind: "GAME", accountId: "account-a", gameId: "game-a" },
      "game.score",
    );
    const fabricated = JSON.parse(JSON.stringify(actor));
    expect(() =>
      requireTrustedActor(fabricated, "account-a", "game.score"),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_REQUIRED" }));
  });

  it("fails closed for disabled users, inactive memberships, and cross-account targets", async () => {
    const store = new MutableStore();
    const service = new AuthorizationService(store);
    store.userActive = false;
    await expect(
      service.authorize(
        identity,
        { kind: "GAME", accountId: "account-a", gameId: "game-a" },
        "game.score",
      ),
    ).rejects.toMatchObject({ code: "USER_DISABLED" });
    store.userActive = true;
    store.authority = null;
    await expect(
      service.authorize(
        identity,
        { kind: "GAME", accountId: "account-a", gameId: "game-a" },
        "game.score",
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });
    await expect(
      service.authorize(
        identity,
        { kind: "GAME", accountId: "account-b", gameId: "game-a" },
        "game.score",
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_MEMBERSHIP" });
  });

  it("applies exact team, season, and game scope without sibling bleed", () => {
    const base: ActiveAuthority = {
      appUserId: "user-a",
      membershipId: "membership-a",
      accountId: "account-a",
      assignments: [],
    };
    expect(
      authorityPermits(
        {
          ...base,
          assignments: [role("COACH_MANAGER", "TEAM", { teamId: "team-a" })],
        },
        "game.setup",
        game,
      ),
    ).toBe(true);
    expect(
      authorityPermits(
        {
          ...base,
          assignments: [role("COACH_MANAGER", "TEAM", { teamId: "team-b" })],
        },
        "game.setup",
        game,
      ),
    ).toBe(false);
    expect(
      authorityPermits(
        {
          ...base,
          assignments: [
            grant("game.correct", "SEASON", { seasonId: "season-b" }),
          ],
        },
        "game.correct",
        game,
      ),
    ).toBe(false);
    expect(
      authorityPermits(
        {
          ...base,
          assignments: [grant("game.correct", "GAME", { gameId: "game-a" })],
        },
        "game.correct",
        game,
      ),
    ).toBe(true);
  });

  it("keeps the canonical role families least-privileged", () => {
    const permitted = (
      value: MembershipRole,
      capability:
        | "ownership.transfer"
        | "membership.update"
        | "roster.manage"
        | "game.score"
        | "game.view",
    ) =>
      authorityPermits(
        {
          appUserId: "user-a",
          membershipId: "membership-a",
          accountId: "account-a",
          assignments: [role(value, "ACCOUNT")],
        },
        capability,
        game,
      );
    expect(permitted("OWNER", "ownership.transfer")).toBe(true);
    expect(permitted("ADMINISTRATOR", "ownership.transfer")).toBe(false);
    expect(permitted("ADMINISTRATOR", "membership.update")).toBe(true);
    expect(permitted("COACH_MANAGER", "membership.update")).toBe(false);
    expect(permitted("COACH_MANAGER", "roster.manage")).toBe(true);
    expect(permitted("SCOREKEEPER", "roster.manage")).toBe(false);
    expect(permitted("SCOREKEEPER", "game.score")).toBe(true);
    expect(permitted("VIEWER", "game.score")).toBe(false);
    expect(permitted("VIEWER", "game.view")).toBe(true);
  });

  it("separates Discord read, configure, preview, and operational authority", () => {
    const accountTarget: ResolvedTarget = {
      kind: "ACCOUNT",
      accountId: "account-a",
      teamIds: [],
      seasonId: null,
      gameId: null,
    };
    const teamTarget: ResolvedTarget = {
      kind: "TEAM",
      accountId: "account-a",
      teamIds: ["team-a"],
      seasonId: null,
      gameId: null,
    };
    const authority = (assignment: AuthorityAssignment): ActiveAuthority => ({
      appUserId: "user-a",
      membershipId: "membership-a",
      accountId: "account-a",
      assignments: [assignment],
    });

    const coach = authority(
      role("COACH_MANAGER", "TEAM", { teamId: "team-a" }),
    );
    expect(authorityPermits(coach, "discord.settings.view", teamTarget)).toBe(
      true,
    );
    expect(
      authorityPermits(coach, "discord.settings.preview", teamTarget),
    ).toBe(true);
    expect(
      authorityPermits(coach, "discord.settings.configure", teamTarget),
    ).toBe(false);

    const administrator = authority(role("ADMINISTRATOR", "ACCOUNT"));
    expect(
      authorityPermits(administrator, "discord.settings.configure", teamTarget),
    ).toBe(true);
    expect(
      authorityPermits(
        administrator,
        "discord.settings.operate",
        accountTarget,
      ),
    ).toBe(true);
    expect(
      authorityPermits(
        authority(
          grant("discord.settings.operate", "TEAM", { teamId: "team-a" }),
        ),
        "discord.settings.operate",
        teamTarget,
      ),
    ).toBe(false);
  });

  it("observes revocation and regrant on each authorization attempt", async () => {
    const store = new MutableStore();
    const service = new AuthorizationService(store);
    const target = {
      kind: "GAME" as const,
      accountId: "account-a",
      gameId: "game-a",
    };
    await expect(
      service.authorize(identity, target, "game.score"),
    ).resolves.toBeDefined();
    store.authority = { ...store.authority!, assignments: [] };
    await expect(
      service.authorize(identity, target, "game.score"),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    store.authority = {
      ...store.authority,
      assignments: [grant("game.score", "GAME", { gameId: "game-a" })],
    } as ActiveAuthority;
    await expect(
      service.authorize(identity, target, "game.score"),
    ).resolves.toBeDefined();
  });

  it("requires same-origin cookie-authenticated mutations", () => {
    expect(() =>
      requireSameOrigin(
        new Request("https://app.example.test/accounts", {
          method: "POST",
          headers: {
            host: "app.example.test",
            origin: "https://evil.example.test",
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_REQUIRED" }));
    expect(() =>
      requireSameOrigin(
        new Request("https://app.example.test/accounts", {
          method: "POST",
          headers: {
            host: "app.example.test",
            origin: "https://app.example.test",
          },
        }),
      ),
    ).not.toThrow();
  });
});
