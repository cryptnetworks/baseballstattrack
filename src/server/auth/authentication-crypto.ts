import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import { AuthorizationError } from "@/server/auth/errors";
import { runtimeSecretConfiguration } from "@/server/config/runtime-environment";

const sessionTokenSchema = z
  .string()
  .regex(
    /^bst1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u,
  );

export function loadAuthenticationKey(
  encoded = runtimeSecretConfiguration().authenticationEncryptionKey,
): Buffer {
  if (!encoded) {
    throw new AuthorizationError(
      "CONFIGURATION_ERROR",
      "Authentication encryption is not configured.",
    );
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new AuthorizationError(
      "CONFIGURATION_ERROR",
      "Authentication encryption is not configured.",
    );
  }
  return key;
}

function derivedKey(root: Buffer, purpose: string): Buffer {
  return createHmac("sha256", root)
    .update(`baseballstattrack:authentication:v1:${purpose}`, "utf8")
    .digest();
}

export function randomOpaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function opaqueHash(
  value: string,
  purpose: "session" | "state" | "browser",
  root = loadAuthenticationKey(),
): string {
  return `hmac-sha256:v1:${createHmac("sha256", derivedKey(root, purpose))
    .update(value, "utf8")
    .digest("hex")}`;
}

export function hashesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function encryptAuthenticationPayload(
  value: unknown,
  root = loadAuthenticationKey(),
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(root, "payload"), iv);
  cipher.setAAD(Buffer.from("baseballstattrack:oauth-attempt:v1", "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return `aes-256-gcm:v1:${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptAuthenticationPayload<T>(
  encoded: string,
  root = loadAuthenticationKey(),
): T {
  try {
    const [algorithm, version, ivValue, ciphertextValue, tagValue, extra] =
      encoded
        .split(":")
        .flatMap((part, index) => (index === 2 ? part.split(".") : [part]));
    if (
      algorithm !== "aes-256-gcm" ||
      version !== "v1" ||
      !ivValue ||
      !ciphertextValue ||
      !tagValue ||
      extra
    ) {
      throw new Error("invalid envelope");
    }
    const decodeCanonical = (value: string) => {
      const decoded = Buffer.from(value, "base64url");
      if (decoded.toString("base64url") !== value) {
        throw new Error("non-canonical base64url");
      }
      return decoded;
    };
    const iv = decodeCanonical(ivValue);
    const ciphertext = decodeCanonical(ciphertextValue);
    const tag = decodeCanonical(tagValue);
    if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid size");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derivedKey(root, "payload"),
      iv,
    );
    decipher.setAAD(Buffer.from("baseballstattrack:oauth-attempt:v1", "utf8"));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      ),
    ) as T;
  } catch {
    throw new AuthorizationError("INVALID_SESSION");
  }
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function issueSessionToken(externalId: string) {
  const secret = randomOpaque(32);
  return {
    secret,
    token: `bst1.${externalId}.${secret}`,
  };
}

export function parseSessionToken(value: string) {
  const parsed = sessionTokenSchema.safeParse(value);
  if (!parsed.success) throw new AuthorizationError("INVALID_SESSION");
  const [, externalId, secret] = parsed.data.split(".");
  return { externalId: externalId!, secret: secret! };
}
