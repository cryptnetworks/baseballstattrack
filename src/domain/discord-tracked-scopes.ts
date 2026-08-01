import { z } from "zod";

import {
  DISCORD_SETTINGS_MAX_SCOPES,
  discordTrackedScopeSchema,
} from "@/domain/discord-settings";

const id = z.string().trim().min(1).max(128);

export const discordTrackedScopesUpdateSchema = z
  .object({
    accountId: id,
    installationId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    trackedScopes: z
      .array(discordTrackedScopeSchema)
      .max(DISCORD_SETTINGS_MAX_SCOPES),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.trackedScopes.map(({ teamId, seasonId }) =>
      discordTrackedScopeKey(teamId, seasonId),
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["trackedScopes"],
        message: "Tracked team-season selections must be unique.",
      });
    }
  });

export const discordGameScopeTreatments = [
  {
    id: "upcoming",
    label: "Upcoming",
    description:
      "Draft and ready games are followed from their next configured event; saving never sends historical messages.",
  },
  {
    id: "inProgress",
    label: "In progress",
    description:
      "Active and suspended games begin following new events after the scope is saved, without replaying older updates.",
  },
  {
    id: "completed",
    label: "Completed",
    description:
      "Completed and verified games remain eligible for configured finals, summaries, and digests.",
  },
  {
    id: "corrected",
    label: "Corrected",
    description:
      "Corrected games remain visible and use the correction route while awaiting or after reverification.",
  },
  {
    id: "archived",
    label: "Archived",
    description:
      "Archived games and team-seasons remain historical evidence but generate no new Discord delivery.",
  },
  {
    id: "incomplete",
    label: "Incomplete",
    description:
      "Abandoned and cancelled games are retained for context and are not delivered as final scores.",
  },
] as const;

export type DiscordGameScopeCategory =
  (typeof discordGameScopeTreatments)[number]["id"];

export function discordGameScopeCategory(
  status:
    | "DRAFT"
    | "READY"
    | "IN_PROGRESS"
    | "SUSPENDED"
    | "COMPLETED"
    | "VERIFIED"
    | "CORRECTED"
    | "ABANDONED"
    | "CANCELLED",
  archived: boolean,
): DiscordGameScopeCategory {
  if (archived) return "archived";
  if (status === "DRAFT" || status === "READY") return "upcoming";
  if (status === "IN_PROGRESS" || status === "SUSPENDED") {
    return "inProgress";
  }
  if (status === "COMPLETED" || status === "VERIFIED") return "completed";
  if (status === "CORRECTED") return "corrected";
  return "incomplete";
}

export function discordTrackedScopeKey(teamId: string, seasonId: string) {
  return `${teamId}:${seasonId}`;
}

export function parseDiscordTrackedScopeKey(value: unknown) {
  const parsed = z.string().max(80).parse(value);
  const [teamId, seasonId, extra] = parsed.split(":");
  if (!teamId || !seasonId || extra) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Invalid tracked team-season selection.",
      },
    ]);
  }
  return discordTrackedScopeSchema.parse({ teamId, seasonId });
}

export type DiscordTrackedScopesUpdate = z.infer<
  typeof discordTrackedScopesUpdateSchema
>;
