import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/server/auth/errors";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorize: vi.fn(),
  resolveAccount: vi.fn(),
  resolveGame: vi.fn(),
  resolveSeasonTeam: vi.fn(),
  account: vi.fn(),
  directory: vi.fn(),
  boxScore: vi.fn(),
  leaders: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("@/server/auth/next-session", () => ({
  authenticateRouteRequest: mocks.authenticate,
}));
vi.mock("@/server/auth/application", () => ({
  getAuthorizationService: () => ({
    listAvailableAccounts: mocks.listAccounts,
  }),
}));
vi.mock("@/server/auth/protected-boundary", () => ({
  authorizeProtectedRequest: mocks.authorize,
}));
vi.mock("@/server/data/prisma", () => ({ getPrismaClient: () => ({}) }));
vi.mock("@/server/data/statistics-api-repository", () => ({
  PrismaStatisticsApiRepository: class {
    resolveAccount = mocks.resolveAccount;
    resolveGame = mocks.resolveGame;
    resolveSeasonTeam = mocks.resolveSeasonTeam;
  },
}));
vi.mock("@/server/app/statistics-api-service", () => ({
  getStatisticsApiService: () => ({
    account: mocks.account,
    directory: mocks.directory,
    boxScore: mocks.boxScore,
    leaders: mocks.leaders,
  }),
}));

import { GET } from "@/app/api/v1/accounts/[...path]/route";
import { GET as GET_ACCOUNTS } from "@/app/api/v1/accounts/route";

const accountExternal = "00000000-0000-4000-8000-000000000091";
const gameExternal = "00000000-0000-4000-8000-000000000092";
const seasonExternal = "00000000-0000-4000-8000-000000000093";
const teamExternal = "00000000-0000-4000-8000-000000000094";

function request(path: string, query = "") {
  return new Request(`https://example.test/api/v1/accounts/${path}${query}`, {
    headers: { authorization: "Bearer test-token" },
  });
}

function invoke(path: string[], query = "") {
  return GET(request(path.join("/"), query), {
    params: Promise.resolve({ path }),
  });
}

describe("statistics API v1 HTTP authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      provider: "supabase",
      providerSubject: "viewer",
    });
    mocks.resolveAccount.mockResolvedValue({
      id: "account-internal",
      externalId: accountExternal,
    });
    mocks.resolveGame.mockResolvedValue({ id: "game-internal" });
    mocks.resolveSeasonTeam.mockResolvedValue({
      seasonId: "season-internal",
      teamId: "team-internal",
    });
    mocks.authorize.mockResolvedValue({ target: { kind: "ACCOUNT" } });
    mocks.directory.mockResolvedValue({ apiVersion: "v1", data: [] });
    mocks.boxScore.mockResolvedValue({ apiVersion: "v1", data: {} });
    mocks.leaders.mockResolvedValue({ apiVersion: "v1", data: {} });
    mocks.listAccounts.mockResolvedValue([]);
  });

  it.each([
    ["unauthenticated", "AUTHENTICATION_REQUIRED"],
    ["invalid credential", "INVALID_SESSION"],
  ])("rejects %s requests before resource lookup", async (_label, code) => {
    mocks.authenticate.mockRejectedValueOnce(
      new AuthorizationError(code as never),
    );
    const response = await invoke([accountExternal, "games"]);
    expect(response.status).toBe(401);
    expect(mocks.resolveAccount).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: "Authentication is required.",
    });
  });

  it.each(["NO_ACTIVE_MEMBERSHIP", "RESOURCE_UNAVAILABLE"])(
    "returns a non-enumerating denial for %s",
    async (code) => {
      mocks.authorize.mockRejectedValueOnce(
        new AuthorizationError(code as never),
      );
      const response = await invoke([accountExternal, "games"]);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "The requested operation is unavailable.",
      });
      expect(mocks.directory).not.toHaveBeenCalled();
    },
  );

  it("allows Viewer reads and preserves versioned empty pagination", async () => {
    mocks.directory.mockResolvedValueOnce({
      apiVersion: "v1",
      data: [],
      page: { limit: 25, nextCursor: null },
    });
    const response = await invoke([accountExternal, "games"], "?limit=25");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-api-version")).toBe("v1");
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.baseballstattrack.stats.v1+json",
    );
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      data: [],
      page: { nextCursor: null },
    });
  });

  it("lists only externally identified available Accounts", async () => {
    mocks.listAccounts.mockResolvedValueOnce([
      {
        id: "account-internal",
        externalId: accountExternal,
        slug: "private-slug",
        displayName: "Stars",
      },
    ]);
    const response = await GET_ACCOUNTS(request(""));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      apiVersion: "v1",
      data: [{ id: accountExternal, displayName: "Stars" }],
    });
    expect(JSON.stringify(body)).not.toContain("account-internal");
    expect(JSON.stringify(body)).not.toContain("private-slug");
  });

  it("authorizes exact game and team-season targets", async () => {
    await invoke([accountExternal, "games", gameExternal, "box-score"]);
    expect(mocks.resolveGame).toHaveBeenCalledWith(
      "account-internal",
      gameExternal,
    );
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Function),
      expect.anything(),
      {
        kind: "GAME",
        accountId: "account-internal",
        gameId: "game-internal",
      },
      "report.view",
    );

    await invoke(
      [accountExternal, "seasons", seasonExternal, "leaders"],
      `?teamId=${teamExternal}`,
    );
    expect(mocks.resolveSeasonTeam).toHaveBeenCalledWith(
      "account-internal",
      seasonExternal,
      teamExternal,
    );
    expect(mocks.authorize).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.anything(),
      {
        kind: "TEAM",
        accountId: "account-internal",
        teamId: "team-internal",
      },
      "report.view",
    );
    expect(mocks.leaders).toHaveBeenCalled();
  });

  it("rejects malformed filters and unavailable games without invoking reads", async () => {
    const malformed = await invoke([
      accountExternal,
      "seasons",
      seasonExternal,
      "leaders",
    ]);
    expect(malformed.status).toBe(400);
    mocks.resolveGame.mockResolvedValueOnce(null);
    const unavailable = await invoke([
      accountExternal,
      "games",
      gameExternal,
      "box-score",
    ]);
    expect(unavailable.status).toBe(404);
    expect(mocks.boxScore).not.toHaveBeenCalled();
  });

  it("keeps unavailable Account, game, and team-season scopes separated", async () => {
    mocks.resolveAccount.mockResolvedValueOnce(null);
    const account = await invoke([accountExternal, "games"]);
    expect(account.status).toBe(404);
    expect(mocks.authorize).not.toHaveBeenCalled();

    mocks.resolveGame.mockResolvedValueOnce(null);
    const game = await invoke([
      accountExternal,
      "games",
      gameExternal,
      "box-score",
    ]);
    expect(game.status).toBe(404);

    mocks.resolveSeasonTeam.mockResolvedValueOnce(null);
    const teamSeason = await invoke(
      [accountExternal, "seasons", seasonExternal, "leaders"],
      `?teamId=${teamExternal}`,
    );
    expect(teamSeason.status).toBe(404);
    expect(mocks.leaders).not.toHaveBeenCalled();
  });
});
