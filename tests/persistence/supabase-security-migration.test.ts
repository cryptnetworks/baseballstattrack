import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260801034000_supabase_security_hardening/migration.sql",
  "utf8",
);

describe("Supabase database hardening", () => {
  it("moves extension objects out of the exposed public schema", () => {
    expect(migration).toContain(
      'ALTER EXTENSION "btree_gist" SET SCHEMA "extensions"',
    );
  });

  it("fixes every repository function search path and removes API-role execution", () => {
    const altered = migration.match(/ALTER FUNCTION/gu) ?? [];
    const revoked = migration.match(/^REVOKE ALL ON FUNCTION/gmu) ?? [];

    expect(altered).toHaveLength(23);
    expect(revoked).toHaveLength(23);
    expect(migration).not.toMatch(/SECURITY DEFINER/iu);
    expect(migration).toMatch(
      /SET search_path = pg_catalog, public[\s\S]+FROM PUBLIC/u,
    );
    expect(migration).toContain(
      "ARRAY['anon', 'authenticated', 'service_role']",
    );
  });
});
