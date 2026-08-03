import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const askpass = path.resolve("scripts/wiki-git-askpass.sh");

describe("wiki Git askpass adapter", () => {
  it("provides the fixed username and runtime token without storing credentials", () => {
    const env = { ...process.env, WIKI_PUBLISH_TOKEN: "test-wiki-token" };

    expect(
      execFileSync("sh", [askpass, "Username for 'https://github.com':"], {
        encoding: "utf8",
        env,
      }).trim(),
    ).toBe("x-access-token");
    expect(
      execFileSync("sh", [askpass, "Password for 'https://github.com':"], {
        encoding: "utf8",
        env,
      }).trim(),
    ).toBe("test-wiki-token");
  });

  it("fails closed when the token is unavailable", () => {
    const env = { ...process.env };
    delete env.WIKI_PUBLISH_TOKEN;

    const result = spawnSync(
      "sh",
      [askpass, "Password for 'https://github.com':"],
      { encoding: "utf8", env },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
