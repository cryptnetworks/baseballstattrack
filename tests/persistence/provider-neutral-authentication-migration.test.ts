import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260803163000_provider_neutral_authentication/migration.sql",
  "utf8",
);

describe("provider-neutral authentication migration", () => {
  it("backfills legacy identities without changing application ownership", () => {
    expect(migration).toContain('CREATE TABLE "AuthenticationIdentity"');
    expect(migration).toContain(
      "'LEGACY_BACKFILL'::\"AuthenticationIdentitySource\"",
    );
    expect(migration).toMatch(
      /SELECT[\s\S]+"id", "provider", "providerSubject"[\s\S]+FROM "AppUser"/u,
    );
    expect(migration).not.toMatch(/UPDATE "AppUser"/u);
  });

  it("binds sessions to one exact application user and provider identity", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("appUserId", "identityId") REFERENCES "AuthenticationIdentity"("appUserId", "id")',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AuthenticationSession_identity_immutable"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AuthenticationSessionEvent_append_only"',
    );
  });

  it("stores only hashed or encrypted browser credentials and consumes state once", () => {
    expect(migration).toContain("hmac-sha256:v1:");
    expect(migration).toContain("aes-256-gcm:v1:");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "OAuthLoginAttempt_stateHash_key"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "OAuthLoginAttempt_one_time_consumption"',
    );
    const identityTriggerFunction = migration.match(
      /CREATE OR REPLACE FUNCTION "protect_authentication_identity"\(\)[\s\S]+?\$\$ LANGUAGE plpgsql/u,
    )?.[0];
    const loginAttemptTriggerFunction = migration.match(
      /CREATE OR REPLACE FUNCTION "protect_oauth_login_attempt"\(\)[\s\S]+?\$\$ LANGUAGE plpgsql/u,
    )?.[0];

    expect(identityTriggerFunction).toBeDefined();
    expect(identityTriggerFunction).not.toContain('"initiatingSessionId"');
    expect(loginAttemptTriggerFunction).toContain('"initiatingSessionId"');
  });

  it("denies direct API roles access to authentication tables", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "ARRAY['AuthenticationIdentity', 'AuthenticationSession', 'AuthenticationSessionEvent', 'OAuthLoginAttempt']",
    );
    expect(migration).toContain(
      "ARRAY['anon', 'authenticated', 'service_role']",
    );
  });
});
