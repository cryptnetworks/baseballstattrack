import { z } from "zod";

export const discordControlActions = [
  "READ_ONLY",
  "CONFIGURE",
  "PREVIEW",
  "OPERATE",
] as const;

export const DISCORD_MEMBERSHIP_MAX_AGE_MS = 5 * 60 * 1_000;

const id = z.string().trim().min(1).max(128);
const externalId = z.uuid();
const reasonCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/u)
  .optional();

export const discordRoleGrantUpdateSchema = z
  .object({
    accountId: id,
    installationId: externalId,
    roleId: externalId,
    expectedRevision: z.number().int().min(0),
    actions: z
      .array(z.enum(discordControlActions))
      .min(1)
      .max(discordControlActions.length),
    reasonCode,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.actions).size !== value.actions.length) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Discord control actions must be unique.",
      });
    }
  });

export const discordRoleGrantRevokeSchema = z
  .object({
    accountId: id,
    installationId: externalId,
    roleId: externalId,
    expectedRevision: z.number().int().min(1),
    reasonCode,
  })
  .strict();

export type DiscordControlAction = (typeof discordControlActions)[number];
export type DiscordRoleGrantUpdateInput = z.infer<
  typeof discordRoleGrantUpdateSchema
>;
export type DiscordRoleGrantRevokeInput = z.infer<
  typeof discordRoleGrantRevokeSchema
>;

export type DiscordPermissionDenialCode =
  | "APP_MEMBERSHIP_STALE"
  | "INSTALLATION_INACTIVE"
  | "GUILD_MEMBERSHIP_STALE"
  | "GUILD_MISMATCH"
  | "ROLE_UNAVAILABLE"
  | "ACTION_NOT_GRANTED";

export const discordPermissionUiFailures = Object.freeze({
  SIGN_IN_REQUIRED: {
    title: "Sign in required",
    recovery: "Sign in and try the Discord action again.",
  },
  DISCORD_PERMISSION_REQUIRED: {
    title: "Permission required",
    recovery: "Ask an account administrator to review your access.",
  },
  DISCORD_MEMBERSHIP_STALE: {
    title: "Discord access needs verification",
    recovery: "Refresh your Discord membership before trying again.",
  },
  DISCORD_RESOURCE_UNAVAILABLE: {
    title: "Discord resource unavailable",
    recovery: "Return to the server list and select an available server.",
  },
  DISCORD_PERMISSION_CONFLICT: {
    title: "Permissions changed",
    recovery: "Reload the latest permissions before saving again.",
  },
});

export type DiscordPermissionUiFailureCode =
  keyof typeof discordPermissionUiFailures;

export function discordPermissionUiFailure(
  code: string,
): Readonly<{ title: string; recovery: string }> {
  if (code in discordPermissionUiFailures) {
    return discordPermissionUiFailures[code as DiscordPermissionUiFailureCode];
  }
  return {
    title: "Discord action unavailable",
    recovery: "Try again or contact an account administrator.",
  };
}

export type DiscordMembershipEvidence = Readonly<{
  appMembershipActive: boolean;
  installationStatus: "PENDING" | "ACTIVE" | "DISCONNECTED" | "REVOKED";
  expectedGuildId: string;
  observedGuildId: string;
  guildMembershipVerifiedAt: Date;
  observedRoleIds: readonly string[];
  grants: readonly Readonly<{
    roleId: string;
    enabled: boolean;
    status: "ACTIVE" | "REVOKED";
    actions: readonly DiscordControlAction[];
  }>[];
}>;

export type DiscordPermissionDecision =
  | Readonly<{
      allowed: true;
      actions: readonly DiscordControlAction[];
    }>
  | Readonly<{
      allowed: false;
      code: DiscordPermissionDenialCode;
      actions: readonly [];
    }>;

function denied(code: DiscordPermissionDenialCode): DiscordPermissionDecision {
  return { allowed: false, code, actions: [] };
}

export function evaluateDiscordPermissions(
  evidence: DiscordMembershipEvidence,
  requiredAction: DiscordControlAction,
  now = new Date(),
): DiscordPermissionDecision {
  if (!evidence.appMembershipActive) {
    return denied("APP_MEMBERSHIP_STALE");
  }
  if (evidence.installationStatus !== "ACTIVE") {
    return denied("INSTALLATION_INACTIVE");
  }
  const membershipAge =
    now.getTime() - evidence.guildMembershipVerifiedAt.getTime();
  if (
    !Number.isFinite(membershipAge) ||
    membershipAge < 0 ||
    membershipAge > DISCORD_MEMBERSHIP_MAX_AGE_MS
  ) {
    return denied("GUILD_MEMBERSHIP_STALE");
  }
  if (evidence.expectedGuildId !== evidence.observedGuildId) {
    return denied("GUILD_MISMATCH");
  }

  const observedRoleIds = new Set(evidence.observedRoleIds);
  const matchingGrants = evidence.grants.filter(
    (grant) =>
      observedRoleIds.has(grant.roleId) &&
      grant.enabled &&
      grant.status === "ACTIVE",
  );
  if (!matchingGrants.length) {
    return denied("ROLE_UNAVAILABLE");
  }
  const actions = discordControlActions.filter((action) =>
    matchingGrants.some((grant) => grant.actions.includes(action)),
  );
  if (!actions.includes(requiredAction)) {
    return denied("ACTION_NOT_GRANTED");
  }
  return { allowed: true, actions };
}
