import { z } from "zod";

export const EXPORT_ARTIFACT_TTL_MILLISECONDS = 5 * 60 * 1_000;
export const ACCOUNT_DELETION_GRACE_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export const PRIVACY_CONFIRMATION = Object.freeze({
  ACCOUNT: "DELETE ACCOUNT DATA",
  USER: "DETACH MY USER",
  PLAYER: "PSEUDONYMIZE PLAYER",
});

const boundedId = z.string().trim().min(1).max(128);
const reasonCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/u);

export const prepareExportSchema = z
  .object({
    accountId: boundedId,
    clientRequestId: boundedId,
  })
  .strict();

export const exportArtifactAccessSchema = z
  .object({
    accountId: boundedId,
    artifactId: boundedId,
    token: z.string().min(32).max(256),
  })
  .strict();

export const createPrivacyRequestSchema = z
  .object({
    accountId: boundedId,
    target: z.enum(["ACCOUNT", "USER", "PLAYER"]),
    targetId: boundedId,
    clientRequestId: boundedId,
    confirmation: z.string().max(64),
    reasonCode,
  })
  .strict();

export const privacyRequestReferenceSchema = z
  .object({ accountId: boundedId, requestId: boundedId })
  .strict();

export const cancelPrivacyRequestSchema = privacyRequestReferenceSchema.extend({
  target: z.enum(["ACCOUNT", "USER", "PLAYER"]),
});

export const privacyHoldSchema = z
  .object({
    accountId: boundedId,
    requestId: boundedId.nullable(),
    reasonCode,
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const privacyHoldReferenceSchema = z
  .object({ accountId: boundedId, holdId: boundedId })
  .strict();

export type PrepareExportInput = z.infer<typeof prepareExportSchema>;
export type ExportArtifactAccessInput = z.infer<
  typeof exportArtifactAccessSchema
>;
export type CreatePrivacyRequestInput = z.infer<
  typeof createPrivacyRequestSchema
>;
export type PrivacyRequestReference = z.infer<
  typeof privacyRequestReferenceSchema
>;
export type CancelPrivacyRequestInput = z.infer<
  typeof cancelPrivacyRequestSchema
>;
export type PrivacyHoldInput = z.infer<typeof privacyHoldSchema>;
export type PrivacyHoldReference = z.infer<typeof privacyHoldReferenceSchema>;

export type PrivacyLifecycleErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "EXPORT_UNAVAILABLE"
  | "HOLD_ACTIVE"
  | "INVALID_LIFECYCLE_INPUT"
  | "LIFECYCLE_CONFLICT"
  | "LIFECYCLE_UNAVAILABLE"
  | "NOT_READY";

export class PrivacyLifecycleError extends Error {
  constructor(
    readonly code: PrivacyLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrivacyLifecycleError";
  }
}

export function requiredPrivacyConfirmation(
  target: keyof typeof PRIVACY_CONFIRMATION,
) {
  return PRIVACY_CONFIRMATION[target];
}
