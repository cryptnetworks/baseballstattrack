import { z } from "zod";

import { discordSchedulePolicySchema } from "@/domain/discord-update-schedule";

const accountId = z.string().trim().min(1).max(128);
const installationId = z.uuid();
const revision = z.number().int().min(0);
const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Schedule time zone must be an IANA time zone.");

export const discordCadenceUpdateSchema = z
  .object({
    accountId,
    installationId,
    expectedRevision: revision,
    ...discordSchedulePolicySchema.shape,
    quietHours: z
      .object({
        enabled: z.boolean(),
        startMinute: z.number().int().min(0).max(1_439),
        endMinute: z.number().int().min(0).max(1_439),
        timeZone,
      })
      .strict(),
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
    if (value.quietHours.startMinute === value.quietHours.endMinute) {
      context.addIssue({
        code: "custom",
        path: ["quietHours"],
        message: "Quiet-hours start and end must be different.",
      });
    }
  });

export const discordCadenceStateSchema = z
  .object({
    accountId,
    installationId,
    expectedRevision: revision,
    operation: z.enum(["PAUSE", "RESUME"]),
  })
  .strict();

export const discordManualRefreshSchema = z
  .object({ accountId, installationId, expectedRevision: revision })
  .strict();

export function minuteOfDay(value: string) {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) throw new Error("Time must use HH:MM.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Time is out of range.");
  return hour * 60 + minute;
}

export function timeOfDay(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
