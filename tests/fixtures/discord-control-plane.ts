import type { PrismaClient } from "@prisma/client";

import type { DiscordSettingsUpdateInput } from "@/domain/discord-settings";
import { DiscordSettingsService } from "@/server/app/discord-settings-service";
import type { TrustedActorContext } from "@/server/auth/types";
import { PrismaDiscordChannelRoutingRepository } from "@/server/data/discord-channel-routing-repository";
import { PrismaDiscordInstallationRepository } from "@/server/data/discord-installation-repository";
import { PrismaDiscordSettingsRepository } from "@/server/data/discord-settings-repository";
import { trustedActorForTest } from "./trusted-actor";

export type DiscordFixtureServer = Readonly<{
  accountId: string;
  accountExternalId: string;
  teamId: string;
  seasonId: string;
  gameId: string;
  installationId: string;
  destinationId: string;
  providerChannelId: string;
  settingsRevision: number;
  actor: TrustedActorContext;
}>;

export type DiscordControlPlaneFixture = Readonly<{
  primary: DiscordFixtureServer;
  sibling: DiscordFixtureServer;
  otherAccount: DiscordFixtureServer;
  channelRepository: PrismaDiscordChannelRoutingRepository;
  settingsRepository: PrismaDiscordSettingsRepository;
  settingsService: DiscordSettingsService;
}>;

const triggers = [
  "GAME_STARTED",
  "SCORE_CHANGED",
  "GAME_CORRECTED",
  "GAME_COMPLETED",
] as const;

function snowflake(seed: string, ordinal: number) {
  const digits = seed.replace(/\D/gu, "").slice(-14).padStart(14, "1");
  return `8${digits}${String(ordinal).padStart(2, "0")}`;
}

async function gameScope(
  prisma: PrismaClient,
  accountId: string,
  stem: string,
) {
  const team = await prisma.team.create({
    data: {
      id: `${stem}-team`,
      accountId,
      displayName: `Synthetic fixture team ${stem}`,
    },
  });
  const season = await prisma.season.create({
    data: {
      id: `${stem}-season`,
      accountId,
      displayName: `Synthetic fixture season ${stem}`,
    },
  });
  const teamSeason = await prisma.teamSeason.create({
    data: {
      id: `${stem}-team-season`,
      accountId,
      teamId: team.id,
      seasonId: season.id,
    },
  });
  const game = await prisma.game.create({
    data: {
      id: `${stem}-game`,
      accountId,
      seasonId: season.id,
      teamSeasonId: teamSeason.id,
      status: "DRAFT",
    },
  });
  return {
    teamId: team.externalId,
    seasonId: season.externalId,
    gameId: game.externalId,
  };
}

export function discordFixtureSettingsInput(
  server: Pick<
    DiscordFixtureServer,
    "accountId" | "installationId" | "teamId" | "seasonId" | "destinationId"
  >,
  expectedRevision: number,
  overrides: Partial<DiscordSettingsUpdateInput> = {},
): DiscordSettingsUpdateInput {
  return {
    accountId: server.accountId,
    installationId: server.installationId,
    expectedRevision,
    enabled: true,
    trackedScopes: [{ teamId: server.teamId, seasonId: server.seasonId }],
    destinations: [
      {
        destinationId: server.destinationId,
        purposes: ["LIVE_UPDATES", "FINAL_SCORES", "CORRECTIONS"],
      },
    ],
    cadenceMode: "EVENT_DRIVEN",
    cadenceSeconds: 60,
    gameDayWindow: {
      enabled: false,
      startMinute: 480,
      endMinute: 1_380,
    },
    digest: { enabled: false, minute: 540 },
    catchUpPolicy: "LATEST_ONLY",
    triggers: [...triggers],
    messageStrategy: "EDIT_LIVE_MESSAGE",
    messageFormat: "STANDARD",
    quietHours: {
      enabled: false,
      startMinute: 1_320,
      endMinute: 420,
      timeZone: "UTC",
    },
    ...overrides,
  };
}

export async function createDiscordControlPlaneFixture(
  prisma: PrismaClient,
  suffix: string,
): Promise<DiscordControlPlaneFixture> {
  const stem = `issue116-${process.pid}-${Date.now()}-${suffix}`;
  const account = await prisma.account.create({
    data: {
      id: `${stem}-account`,
      slug: `${stem}-account`,
      displayName: "Synthetic Discord fixture Account",
    },
  });
  const otherAccount = await prisma.account.create({
    data: {
      id: `${stem}-other-account`,
      slug: `${stem}-other-account`,
      displayName: "Synthetic isolated Account",
    },
  });
  const primaryScope = await gameScope(prisma, account.id, `${stem}-primary`);
  const siblingScope = await gameScope(prisma, account.id, `${stem}-sibling`);
  const otherScope = await gameScope(prisma, otherAccount.id, `${stem}-other`);
  const installationRepository = new PrismaDiscordInstallationRepository(
    prisma,
  );
  const channelRepository = new PrismaDiscordChannelRoutingRepository(prisma);
  const settingsRepository = new PrismaDiscordSettingsRepository(prisma);
  const settingsService = new DiscordSettingsService(settingsRepository);

  async function server(
    accountId: string,
    accountExternalId: string,
    scope: Awaited<ReturnType<typeof gameScope>>,
    label: "primary" | "sibling" | "other",
    ordinal: number,
  ): Promise<DiscordFixtureServer> {
    const actor = trustedActorForTest({
      accountId,
      actorId: `${stem}-${label}-administrator`,
      actorKind: "SERVICE",
      actorUserId: null,
      membershipId: null,
      capability: "discord.settings.configure",
      scope: { kind: "ACCOUNT" },
      authorizedAt: "2026-08-02T12:00:00.000Z",
    });
    const connected = await installationRepository.connect({
      accountId,
      guildId: snowflake(stem, ordinal),
      guildDisplayName: `Synthetic ${label} server`,
      credentialReference: `discord/test-fixtures/${stem}/${label}`,
      installerFingerprint: String(ordinal).repeat(64),
      actor,
      correlationId: `${stem}-${label}-onboarding`,
    });
    if (connected.outcome === "unavailable") {
      throw new Error(`Synthetic ${label} Discord installation unavailable.`);
    }
    const providerChannelId = snowflake(stem, ordinal + 10);
    const channels = await channelRepository.syncChannels({
      accountId,
      installationExternalId: connected.installation.id,
      channels: [
        {
          channelId: providerChannelId,
          displayName: `synthetic-${label}-updates`,
          canView: true,
          canSend: true,
        },
      ],
      actor,
    });
    const destination = channels?.channels[0];
    if (!destination) {
      throw new Error(`Synthetic ${label} Discord channel unavailable.`);
    }
    const unconfigured = {
      accountId,
      accountExternalId,
      ...scope,
      installationId: connected.installation.id,
      destinationId: destination.id,
      providerChannelId,
      settingsRevision: 0,
      actor,
    };
    const configured = await settingsService.update(
      discordFixtureSettingsInput(unconfigured, 0),
      actor,
    );
    return { ...unconfigured, settingsRevision: configured.settings.revision };
  }

  const primary = await server(
    account.id,
    account.externalId,
    primaryScope,
    "primary",
    1,
  );
  const sibling = await server(
    account.id,
    account.externalId,
    siblingScope,
    "sibling",
    2,
  );
  const isolated = await server(
    otherAccount.id,
    otherAccount.externalId,
    otherScope,
    "other",
    3,
  );
  return {
    primary,
    sibling,
    otherAccount: isolated,
    channelRepository,
    settingsRepository,
    settingsService,
  };
}
