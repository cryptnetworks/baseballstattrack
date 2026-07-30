import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, createServerClient, getUser, signOut } = vi.hoisted(
  () => {
    const getUser = vi.fn();
    const signOut = vi.fn();
    return {
      getUser,
      signOut,
      createClient: vi.fn(() => ({ auth: { getUser, signOut } })),
      createServerClient: vi.fn(() => ({ auth: { getUser, signOut } })),
    };
  },
);

vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

import {
  authenticateSupabaseCookies,
  authenticateSupabaseRequest,
  signOutSupabaseCookies,
  type SessionCookieStore,
} from "@/server/auth/supabase-session";

const cookieStore: SessionCookieStore = {
  getAll: () => [{ name: "provider-cookie", value: "opaque" }],
  setAll: vi.fn(),
};

describe("Supabase session authentication", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "publishable-key";
    getUser.mockReset();
    signOut.mockReset();
    createClient.mockClear();
    createServerClient.mockClear();
  });

  it("uses a remotely validated cookie subject and ignores profile authority", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "provider-subject",
          email: "mutable@example.test",
          app_metadata: { role: "owner", accountId: "attacker-account" },
        },
      },
      error: null,
    });
    await expect(authenticateSupabaseCookies(cookieStore)).resolves.toEqual({
      provider: "supabase",
      providerSubject: "provider-subject",
    });
    expect(createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      expect.any(Object),
    );
  });

  it("rejects invalid cookies and malformed bearer headers", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid token"),
    });
    await expect(
      authenticateSupabaseCookies(cookieStore),
    ).rejects.toMatchObject({ code: "INVALID_SESSION" });
    await expect(
      authenticateSupabaseRequest(
        new Request("https://app.example.test/api/auth/context", {
          headers: { authorization: "Basic not-a-bearer-token" },
        }),
        cookieStore,
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("validates bearer tokens with Supabase instead of decoding claims locally", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "bearer-subject" } },
      error: null,
    });
    await expect(
      authenticateSupabaseRequest(
        new Request("https://app.example.test/api/auth/context", {
          headers: { authorization: "Bearer opaque-provider-token" },
        }),
        cookieStore,
      ),
    ).resolves.toEqual({
      provider: "supabase",
      providerSubject: "bearer-subject",
    });
    expect(getUser).toHaveBeenCalledWith("opaque-provider-token");
  });

  it("fails closed when provider configuration is absent", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(
      authenticateSupabaseCookies(cookieStore),
    ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  });

  it("signs out the local provider session without accepting a browser actor", async () => {
    signOut.mockResolvedValue({ error: null });
    await signOutSupabaseCookies(cookieStore);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
