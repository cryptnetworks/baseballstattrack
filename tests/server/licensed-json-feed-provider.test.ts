import { describe, expect, it } from "vitest";

import { LicensedJsonFeedProvider } from "@/server/providers/licensed-json-feed";

const key = "synthetic-provider-key-at-least-24-characters";

describe("licensed JSON feed credential boundary", () => {
  it("binds the credential to its deployment-approved origin", () => {
    expect(
      () =>
        new LicensedJsonFeedProvider(
          "https://feed.example.test/base/",
          key,
          "https://feed.example.test",
        ),
    ).not.toThrow();
  });

  it("rejects redirects to another origin or an origin with a path", () => {
    expect(
      () =>
        new LicensedJsonFeedProvider(
          "https://attacker.example.test/",
          key,
          "https://feed.example.test",
        ),
    ).toThrow("Licensed provider configuration is invalid.");
    expect(
      () =>
        new LicensedJsonFeedProvider(
          "https://feed.example.test/",
          key,
          "https://feed.example.test/not-an-origin",
        ),
    ).toThrow("Licensed provider configuration is invalid.");
  });
});
