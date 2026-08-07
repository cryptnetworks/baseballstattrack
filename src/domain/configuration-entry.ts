import { z } from "zod";

export const secretReferenceProviderSchema = z.enum([
  "AWS_SECRETS_MANAGER",
  "VAULT",
  "DOCKER_SECRET",
  "KUBERNETES_SECRET",
  "ENVIRONMENT",
]);

export const secretReferenceSchema = z
  .object({
    provider: secretReferenceProviderSchema,
    referenceIdentifier: z.string().trim().min(1).max(512),
    environment: z.string().trim().min(1).max(128),
    rotationMetadata: z.record(z.string(), z.string()).optional(),
    lastRotatedAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export type SecretReference = z.infer<typeof secretReferenceSchema>;

function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /(secret|token|password|api[_-]?key|private[_-]?key|signing[_-]?key)/iu.test(
        key,
      ) || containsSecretKey(nested),
  );
}

export const configurationEntrySchema = z
  .object({
    key: z.string().trim().min(1).max(160),
    category: z.enum([
      "FEATURES",
      "CALENDAR",
      "NOTIFICATIONS",
      "INTEGRATIONS",
      "RATE_LIMITS",
      "AUTHENTICATION",
      "DISCORD",
      "EXTERNAL_API",
    ]),
    scope: z.enum(["GLOBAL", "ACCOUNT"]),
    accountId: z.string().trim().min(1).max(128).nullable(),
    ownerId: z.string().trim().min(1).max(128).nullable(),
    visibility: z.enum(["ADMIN", "INTERNAL", "PUBLIC"]),
    value: z.unknown().nullable(),
    secretReference: secretReferenceSchema.nullable(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.scope === "GLOBAL" && entry.accountId !== null) {
      context.addIssue({
        code: "custom",
        path: ["accountId"],
        message: "Global configuration cannot have an Account.",
      });
    }
    if (entry.scope === "ACCOUNT" && entry.accountId === null) {
      context.addIssue({
        code: "custom",
        path: ["accountId"],
        message: "Account configuration requires an Account.",
      });
    }
    if ((entry.value === null) === (entry.secretReference === null)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Provide either a non-sensitive value or a secret reference.",
      });
    }
    if (entry.value !== null && containsSecretKey(entry.value)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message:
          "Secret-shaped values must remain in the external secret manager.",
      });
    }
    if (
      /(secret|token|password|api[_-]?key|private[_-]?key|signing[_-]?key)/iu.test(
        entry.key,
      ) &&
      entry.secretReference === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["secretReference"],
        message: "Sensitive configuration must use a secret reference.",
      });
    }
  });

export type ConfigurationEntry = z.infer<typeof configurationEntrySchema>;
