import { z } from "zod";

import {
  discordDestinationPurposes,
  discordMessageFormats,
} from "@/domain/discord-settings";

export const discordRoutingCategories = [
  {
    id: "LIVE_UPDATES",
    label: "Live updates",
    description: "In-game scoring and inning updates.",
  },
  {
    id: "FINAL_SCORES",
    label: "Final scores",
    description: "Completed-game score announcements.",
  },
  {
    id: "CORRECTIONS",
    label: "Corrections",
    description: "Corrections to previously published results.",
  },
  {
    id: "SUMMARIES",
    label: "Summaries",
    description: "Game and season summary reports.",
  },
  {
    id: "ERRORS",
    label: "Errors",
    description: "Operational delivery failures requiring attention.",
  },
  {
    id: "DIGESTS",
    label: "Digests",
    description: "Scheduled rollups of recent activity.",
  },
] as const satisfies readonly Readonly<{
  id: (typeof discordDestinationPurposes)[number];
  label: string;
  description: string;
}>[];

const id = z.string().trim().min(1).max(128);
const destination = z.uuid();

export const discordChannelRefreshSchema = z
  .object({ accountId: id, installationId: z.uuid() })
  .strict();

export const discordChannelToggleSchema = discordChannelRefreshSchema.extend({
  destinationId: destination,
  enabled: z.boolean(),
});

export const discordChannelRoutingSchema = discordChannelRefreshSchema
  .extend({
    expectedRevision: z.number().int().min(0),
    routes: z.record(
      z.enum(discordDestinationPurposes),
      destination.nullable(),
    ),
  })
  .strict();

export const discordChannelTestSchema = discordChannelRefreshSchema.extend({
  destinationId: destination,
  messageFormat: z.enum(discordMessageFormats),
});

export type DiscordChannelRoutingInput = z.infer<
  typeof discordChannelRoutingSchema
>;

export function groupDiscordRoutes(
  routes: DiscordChannelRoutingInput["routes"],
) {
  const grouped = new Map<
    string,
    (typeof discordDestinationPurposes)[number][]
  >();
  for (const purpose of discordDestinationPurposes) {
    const destinationId = routes[purpose];
    if (!destinationId) continue;
    const purposes = grouped.get(destinationId) ?? [];
    purposes.push(purpose);
    grouped.set(destinationId, purposes);
  }
  return [...grouped.entries()].map(([destinationId, purposes]) => ({
    destinationId,
    purposes,
  }));
}
