import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptAuthenticationPayload,
  encryptAuthenticationPayload,
  hashesEqual,
  issueSessionToken,
  loadAuthenticationKey,
  opaqueHash,
  parseSessionToken,
  pkceChallenge,
} from "@/server/auth/authentication-crypto";

describe("authentication cryptography", () => {
  const key = randomBytes(32);

  it("encrypts callback secrets with authenticated encryption", () => {
    const encrypted = encryptAuthenticationPayload(
      { verifier: "secret", nonce: "nonce" },
      key,
    );
    expect(encrypted).not.toContain("secret");
    expect(
      decryptAuthenticationPayload<{ verifier: string }>(encrypted, key),
    ).toEqual({ verifier: "secret", nonce: "nonce" });
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("a") ? "b" : "a"}`;
    expect(() => decryptAuthenticationPayload(tampered, key)).toThrowError(
      expect.objectContaining({ code: "INVALID_SESSION" }),
    );
  });

  it("separates hashes by purpose and compares without plain token storage", () => {
    const session = opaqueHash("opaque", "session", key);
    const state = opaqueHash("opaque", "state", key);
    expect(session).toMatch(/^hmac-sha256:v1:[a-f0-9]{64}$/u);
    expect(session).not.toBe(state);
    expect(hashesEqual(session, session)).toBe(true);
    expect(hashesEqual(session, state)).toBe(false);
  });

  it("issues validated opaque application session tokens and PKCE challenges", () => {
    const issued = issueSessionToken(randomUUID());
    expect(parseSessionToken(issued.token)).toMatchObject({
      secret: issued.secret,
    });
    expect(pkceChallenge("a".repeat(43))).toHaveLength(43);
    expect(() => parseSessionToken("attacker.jwt.value")).toThrowError(
      expect.objectContaining({ code: "INVALID_SESSION" }),
    );
  });

  it("requires a canonical, exact 32-byte base64url key", () => {
    expect(loadAuthenticationKey(key.toString("base64url"))).toEqual(key);
    for (const invalid of [
      undefined,
      "too-short",
      `${key.toString("base64url")}=`,
    ]) {
      expect(() => loadAuthenticationKey(invalid)).toThrowError(
        expect.objectContaining({ code: "CONFIGURATION_ERROR" }),
      );
    }
  });
});
