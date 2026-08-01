import { z } from "zod";

export const DISCORD_MIN_CADENCE_SECONDS = 60;
export const DISCORD_MAX_CADENCE_SECONDS = 3_600;
export const discordCadenceModes = [
  "EVENT_DRIVEN",
  "FIXED_INTERVAL",
  "MANUAL_ONLY",
] as const;
export const discordCatchUpPolicies = ["SKIP", "LATEST_ONLY"] as const;

export const discordSchedulePolicySchema = z
  .object({
    cadenceMode: z.enum(discordCadenceModes),
    cadenceSeconds: z
      .number()
      .int()
      .min(DISCORD_MIN_CADENCE_SECONDS)
      .max(DISCORD_MAX_CADENCE_SECONDS),
    gameDayWindow: z
      .object({
        enabled: z.boolean(),
        startMinute: z.number().int().min(0).max(1_439),
        endMinute: z.number().int().min(0).max(1_439),
      })
      .strict(),
    digest: z
      .object({
        enabled: z.boolean(),
        minute: z.number().int().min(0).max(1_439),
      })
      .strict(),
    catchUpPolicy: z.enum(discordCatchUpPolicies),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.gameDayWindow.startMinute === value.gameDayWindow.endMinute) {
      context.addIssue({
        code: "custom",
        path: ["gameDayWindow"],
        message: "Game-day window start and end must be different.",
      });
    }
  });

export type DiscordSchedulePolicy = z.infer<typeof discordSchedulePolicySchema>;

type QuietHours = Readonly<{
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  timeZone: string;
}>;

const minuteFormatter = new Map<string, Intl.DateTimeFormat>();

function localMinute(date: Date, timeZone: string) {
  let formatter = minuteFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    minuteFormatter.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find(({ type }) => type === "hour")?.value);
  const minute = Number(parts.find(({ type }) => type === "minute")?.value);
  return hour * 60 + minute;
}

function inWindow(minute: number, startMinute: number, endMinute: number) {
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}

function allowed(
  date: Date,
  policy: DiscordSchedulePolicy,
  quietHours: QuietHours,
) {
  const minute = localMinute(date, quietHours.timeZone);
  return (
    (!policy.gameDayWindow.enabled ||
      inWindow(
        minute,
        policy.gameDayWindow.startMinute,
        policy.gameDayWindow.endMinute,
      )) &&
    (!quietHours.enabled ||
      !inWindow(minute, quietHours.startMinute, quietHours.endMinute))
  );
}

function nextMinute(date: Date) {
  return new Date(Math.ceil((date.getTime() + 1) / 60_000) * 60_000);
}

function scan(start: Date, matches: (candidate: Date) => boolean): Date | null {
  let candidate = nextMinute(start);
  for (let index = 0; index < 8 * 24 * 60; index += 1) {
    if (matches(candidate)) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  return null;
}

export function nextDiscordEvaluation(
  input: Readonly<{
    enabled: boolean;
    policy: DiscordSchedulePolicy;
    quietHours: QuietHours;
    now: Date;
    manualRefreshRequestedAt?: Date | null;
    resumeCatchUp?: boolean;
  }>,
) {
  if (!input.enabled) return null;
  const candidates: Date[] = [];
  const addAllowed = (start: Date) => {
    const candidate = allowed(start, input.policy, input.quietHours)
      ? start
      : scan(start, (value) => allowed(value, input.policy, input.quietHours));
    if (candidate) candidates.push(candidate);
  };

  if (input.manualRefreshRequestedAt) {
    addAllowed(
      input.manualRefreshRequestedAt > input.now
        ? input.manualRefreshRequestedAt
        : input.now,
    );
  }
  if (input.resumeCatchUp) addAllowed(input.now);
  if (input.policy.cadenceMode === "FIXED_INTERVAL") {
    addAllowed(
      new Date(input.now.getTime() + input.policy.cadenceSeconds * 1_000),
    );
  }
  if (input.policy.digest.enabled) {
    const digest = scan(input.now, (candidate) => {
      return (
        localMinute(candidate, input.quietHours.timeZone) ===
          input.policy.digest.minute &&
        allowed(candidate, input.policy, input.quietHours)
      );
    });
    if (digest) candidates.push(digest);
  }
  return (
    candidates.sort((left, right) => left.getTime() - right.getTime())[0] ??
    null
  );
}
