import { z } from "zod";

import { STATISTICS_API_MEDIA_TYPE } from "@/domain/statistics-api";
import {
  DiscordUpdateProviderError,
  discordStatisticsSnapshotSchema,
  type DiscordStatisticsProvider,
  type DiscordUpdateTransport,
  type DiscordUpdateTransportInput,
} from "@/domain/discord-update-worker";

type Fetch = typeof fetch;

function httpsBase(value: string, name: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials.`);
  }
  return url;
}

function apiUrl(base: URL, path: string) {
  return new URL(path, base.toString().replace(/\/?$/u, "/"));
}

const boxScoreEnvelope = z
  .object({
    data: z
      .object({
        version: z.object({
          sourceRevision: z.number().int().min(0),
          correctionCount: z.number().int().min(0),
          verificationState: z.enum(["VERIFIED", "UNVERIFIED"]),
          projectionFreshness: z.enum(["CURRENT", "NOT_USED"]),
        }),
        scoreKind: z.enum(["CURRENT", "FINAL", "TERMINATED"]),
        gameState: z.object({
          inning: z.number().int().min(1).nullable(),
          half: z.enum(["TOP", "BOTTOM"]).nullable(),
        }),
        score: z.object({ AWAY: z.number().int(), HOME: z.number().int() }),
        teams: z.object({
          AWAY: z.object({ displayName: z.string().min(1).max(80) }),
          HOME: z.object({ displayName: z.string().min(1).max(80) }),
        }),
        innings: z.array(
          z.object({
            inning: z.number().int().min(1),
            side: z.enum(["AWAY", "HOME"]),
            runs: z.number().int(),
          }),
        ),
      })
      .passthrough(),
  })
  .passthrough();

export class ConfiguredDiscordStatisticsProvider implements DiscordStatisticsProvider {
  private readonly apiBase: URL;

  constructor(
    apiBase: string,
    private readonly token: string,
    private readonly fetcher: Fetch = fetch,
  ) {
    this.apiBase = httpsBase(apiBase, "DISCORD_STATISTICS_API_BASE_URL");
    if (token.length < 32) {
      throw new Error("Discord statistics API credentials are unavailable.");
    }
  }

  async loadGame(input: {
    accountId: string;
    gameId: string;
    settingsRevision: number;
  }) {
    const url = apiUrl(
      this.apiBase,
      `api/v1/accounts/${encodeURIComponent(input.accountId)}/games/${encodeURIComponent(input.gameId)}/box-score`,
    );
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: STATISTICS_API_MEDIA_TYPE,
          "X-Discord-Settings-Revision": String(input.settingsRevision),
          "User-Agent": "BaseballStatTrack-Discord-Worker/1",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DiscordUpdateProviderError("STATISTICS_UNAVAILABLE", true);
    }
    if (response.status === 401 || response.status === 403) {
      throw new DiscordUpdateProviderError(
        "AUTHENTICATION_FAILED",
        false,
        response.status,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new DiscordUpdateProviderError(
        "STATISTICS_UNAVAILABLE",
        true,
        response.status,
        retryAfter(response),
      );
    }
    if (response.status === 409) {
      throw new DiscordUpdateProviderError(
        "STATISTICS_STALE",
        true,
        response.status,
      );
    }
    if (!response.ok) {
      throw new DiscordUpdateProviderError(
        "STATISTICS_UNAVAILABLE",
        false,
        response.status,
      );
    }
    let parsed: z.infer<typeof boxScoreEnvelope>;
    try {
      parsed = boxScoreEnvelope.parse(await response.json());
    } catch {
      throw new DiscordUpdateProviderError("STATISTICS_UNAVAILABLE", true);
    }
    const data = parsed.data;
    const final = data.scoreKind !== "CURRENT";
    return discordStatisticsSnapshotSchema.parse({
      awayTeam: data.teams.AWAY.displayName,
      homeTeam: data.teams.HOME.displayName,
      awayScore: data.score.AWAY,
      homeScore: data.score.HOME,
      inning: data.gameState.inning ?? 1,
      half: final ? "FINAL" : (data.gameState.half ?? "TOP"),
      latestEvent: `Current accepted game state at source revision ${data.version.sourceRevision}.`,
      correctionSummary:
        data.version.correctionCount > 0
          ? `current state includes ${data.version.correctionCount} accepted correction${data.version.correctionCount === 1 ? "" : "s"}`
          : null,
      reportReady: final && data.version.verificationState === "VERIFIED",
      verified: data.version.verificationState === "VERIFIED",
      sourceRevision: data.version.sourceRevision,
      freshness: "CURRENT",
    });
  }
}

const discordMessageResponse = z.object({
  id: z.string().regex(/^\d{2,32}$/u),
});

function retryAfter(response: Response) {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0
    ? Math.min(86_400, Math.ceil(value))
    : null;
}

export class ConfiguredDiscordUpdateTransport implements DiscordUpdateTransport {
  private readonly apiBase: URL;

  constructor(
    apiBase: string,
    private readonly token: string,
    private readonly fetcher: Fetch = fetch,
  ) {
    this.apiBase = httpsBase(apiBase, "DISCORD_UPDATE_API_BASE_URL");
    if (token.length < 16) {
      throw new Error("Discord update credentials are unavailable.");
    }
  }

  async send(input: DiscordUpdateTransportInput) {
    const editing = input.operation === "EDIT";
    const path = editing
      ? `channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.targetMessageId!)}`
      : `channels/${encodeURIComponent(input.channelId)}/messages`;
    let response: Response;
    try {
      response = await this.fetcher(apiUrl(this.apiBase, path), {
        method: editing ? "PATCH" : "POST",
        headers: {
          Authorization: `Bot ${this.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "User-Agent": "BaseballStatTrack-Discord-Worker/1",
        },
        body: JSON.stringify({
          content: input.content,
          allowed_mentions: { parse: [] },
          ...(editing
            ? {}
            : { nonce: input.idempotencyKey, enforce_nonce: true }),
        }),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
    } catch {
      throw new DiscordUpdateProviderError("PROVIDER_UNAVAILABLE", true);
    }
    if (response.status >= 200 && response.status < 300) {
      try {
        const message = discordMessageResponse.parse(await response.json());
        return { status: response.status, messageId: message.id };
      } catch {
        throw new DiscordUpdateProviderError(
          "PROVIDER_UNAVAILABLE",
          true,
          response.status,
        );
      }
    }
    if (response.status === 401) {
      throw new DiscordUpdateProviderError(
        "AUTHENTICATION_FAILED",
        false,
        response.status,
      );
    }
    if (response.status === 403) {
      throw new DiscordUpdateProviderError(
        "PERMISSION_REQUIRED",
        false,
        response.status,
      );
    }
    if (response.status === 404) {
      throw new DiscordUpdateProviderError(
        "DESTINATION_UNAVAILABLE",
        false,
        response.status,
      );
    }
    if (response.status === 429) {
      throw new DiscordUpdateProviderError(
        "RATE_LIMITED",
        true,
        response.status,
        retryAfter(response),
      );
    }
    if (response.status === 408 || response.status >= 500) {
      throw new DiscordUpdateProviderError(
        "PROVIDER_UNAVAILABLE",
        true,
        response.status,
      );
    }
    throw new DiscordUpdateProviderError(
      "DESTINATION_UNAVAILABLE",
      false,
      response.status,
    );
  }
}
