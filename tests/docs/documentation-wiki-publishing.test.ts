import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPublication,
  PublicationError,
  publishPublication,
} from "../../scripts/publish-docs-wiki.mjs";

const temporaryDirectories: string[] = [];

async function fixture(
  manifest: string,
  files: Record<string, string | Uint8Array>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "baseball-wiki-test-"));
  temporaryDirectories.push(root);
  const docs = path.join(root, "docs");
  await mkdir(docs, { recursive: true });
  await writeFile(path.join(docs, "wiki-manifest.yaml"), manifest);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(docs, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { root, docs, manifest: path.join(docs, "wiki-manifest.yaml") };
}

function manifest(pages = "*.md") {
  return `
version: 2
source:
  root: docs
  repository: https://github.com/cryptnetworks/baseballstattrack
  branch: main
publication:
  generatedDirectory: _generated
  reservedDirectory: _wiki-owned
  landingPage: Home.md
  sidebarPage: _Sidebar.md
  footerPage: _Footer.md
  generatedManifest: _generated/.publication-manifest.json
  publicOnly: true
  navigationUnlisted: append
  excludedLinkPolicy: repository
  repositoryPagesBase: https://github.com/cryptnetworks/baseballstattrack/blob/main/docs
pages:
  - source: "${pages}"
    wiki: "{stem}"
    visibility: public
    order: 10
  - source: wiki-manifest.yaml
    visibility: internal
    reason: test metadata
  - source: internal.md
    visibility: internal
    reason: test internal page
navigation:
  - title: Test
    pages:
      - GUIDE
`;
}

afterEach(async () => {
  delete process.env.WIKI_PUBLISH_TOKEN;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("documentation wiki publication", () => {
  it("parses the repository manifest and expands the public page set", async () => {
    const publication = await buildPublication({
      manifestPath: "docs/wiki-manifest.yaml",
      sourceRoot: "docs",
    });

    expect(publication.pages.length).toBeGreaterThan(50);
    expect(
      publication.pages.every((page) => page.visibility === "public"),
    ).toBe(true);
    expect(publication.files.has("Home.md")).toBe(true);
    expect(publication.files.has("_Sidebar.md")).toBe(true);
    expect(publication.files.has("_Footer.md")).toBe(true);
    expect(publication.files.has("_generated/.publication-manifest.json")).toBe(
      true,
    );
    expect(publication.files.get("Home.md")).toContain(
      "[Rules and calculations](https://github.com/cryptnetworks/baseballstattrack/wiki/Rules-and-Calculations)",
    );
    expect(publication.files.get("Home.md")).toContain(
      "[Design choices](https://github.com/cryptnetworks/baseballstattrack/wiki/Design-Choices)",
    );
    expect(publication.files.get("Home.md")).toContain(
      "deploy the production service",
    );
    expect(publication.files.get("Home.md")).not.toContain(
      "developers, and operators",
    );
    expect(publication.files.get("_Sidebar.md")).toContain(
      "[Production installation](https://github.com/cryptnetworks/baseballstattrack/wiki/Production-Installation)",
    );
    expect(publication.files.has("_generated/Production-Installation.md")).toBe(
      true,
    );
    for (const developmentPage of [
      "CI-Quality-Gates",
      "Defect-Triage-and-Regression-Policy",
      "Discord-End-to-End-Fixtures",
      "Release-and-Workflow-Security",
      "Repository-Operations-Checklist",
      "Roadmap",
      "Wiki-Publishing-Guide",
    ]) {
      expect(publication.files.has(`_generated/${developmentPage}.md`)).toBe(
        false,
      );
    }
    expect(publication.files.get("_Sidebar.md")).not.toContain(
      "More Documentation",
    );
    expect(publication.files.get("_Sidebar.md")).not.toContain(
      "STATISTIC-DERIVATION",
    );
    expect(publication.files.get("_Footer.md")).toContain(
      "authoritative [repository documentation]",
    );
    expect(
      publication.files.get("_generated/.publication-manifest.json"),
    ).toContain('"contentHash"');
  });

  it("keeps linked detail pages discoverable without crowding curated navigation", async () => {
    const curatedManifest = manifest().replace(
      "navigationUnlisted: append",
      "navigationUnlisted: linked",
    );
    const context = await fixture(curatedManifest, {
      "GUIDE.md": "# Guide\n\n[Details](DETAILS.md)\n",
      "DETAILS.md": "# Detailed behavior\n",
    });
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });

    expect(publication.files.has("_generated/DETAILS.md")).toBe(true);
    expect(publication.files.get("_Sidebar.md")).toContain(
      "[Guide](https://github.com/cryptnetworks/baseballstattrack/wiki/GUIDE)",
    );
    expect(publication.files.get("_Sidebar.md")).not.toContain(
      "Detailed behavior",
    );
  });

  it("rejects an undiscoverable detail page in curated navigation", async () => {
    const curatedManifest = manifest().replace(
      "navigationUnlisted: append",
      "navigationUnlisted: linked",
    );
    const context = await fixture(curatedManifest, {
      "GUIDE.md": "# Guide\n",
      "DETAILS.md": "# Detailed behavior\n",
    });

    await expect(
      buildPublication({
        manifestPath: context.manifest,
        sourceRoot: context.docs,
      }),
    ).rejects.toThrow(/undiscoverable.*DETAILS\.md/u);
  });

  it("maps pages, rewrites links and anchors, and copies images", async () => {
    const context = await fixture(manifest(), {
      "GUIDE.md":
        "# Guide\n\nSee [details](DETAILS.md#details).\n\n![Logo](logo.png)\n",
      "DETAILS.md":
        "# Details\n\n## Details\n\n```ts\nconst link = 'DETAILS.md';\n```\n",
      "logo.png": new Uint8Array([137, 80, 78, 71]),
      "internal.md": "# Internal\n",
    });
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });
    const guide = publication.files.get("_generated/GUIDE.md");

    expect(guide).toContain(
      "https://github.com/cryptnetworks/baseballstattrack/wiki/DETAILS#details",
    );
    expect(guide).toContain(
      "https://raw.githubusercontent.com/wiki/cryptnetworks/baseballstattrack/_generated/assets/logo.png",
    );
    expect(publication.files.has("_generated/assets/logo.png")).toBe(true);
    expect(guide).not.toContain("./DETAILS.md';");
    expect(guide).toContain("_Source: [`docs/GUIDE.md`]");
    expect(publication.files.get("_Sidebar.md")).toContain(
      "https://github.com/cryptnetworks/baseballstattrack/wiki/GUIDE",
    );
    expect(publication.files.get("Home.md")).not.toContain("wiki/./");
  });

  it("rewrites docs-root links and preserves GitHub-compatible tables and Mermaid", async () => {
    const context = await fixture(manifest(), {
      "GUIDE.md":
        "# Guide\n\n[Details](docs/DETAILS.md#details)\n\n| Item | Meaning |\n| --- | --- |\n| One | Safe |\n\n```mermaid\ngraph TD\n  A --> B\n```\n",
      "DETAILS.md": "# Details\n\n## Details\n",
    });
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });
    const guide = publication.files.get("_generated/GUIDE.md");

    expect(guide).toContain("wiki/DETAILS#details");
    expect(guide).toContain("| Item | Meaning |");
    expect(guide).toContain("```mermaid");
  });

  it("rejects invalid tables, unsafe active HTML, private paths, and secrets", async () => {
    const invalidTable = await fixture(manifest("GUIDE.md"), {
      "GUIDE.md": "# Guide\n\n| One | Two |\n| --- | --- |\n| Value |\n",
    });
    await expect(
      buildPublication({
        manifestPath: invalidTable.manifest,
        sourceRoot: invalidTable.docs,
      }),
    ).rejects.toThrow(/inconsistent Markdown table row/u);

    for (const unsafeContent of [
      "<script>alert('unsafe')</script>",
      "Use /Users/example/private/file",
      "WIKI_PUBLISH_TOKEN=ghp_not-a-real-token",
    ]) {
      const unsafe = await fixture(manifest("GUIDE.md"), {
        "GUIDE.md": `# Guide\n\n${unsafeContent}\n`,
      });
      await expect(
        buildPublication({
          manifestPath: unsafe.manifest,
          sourceRoot: unsafe.docs,
        }),
      ).rejects.toThrow(/Unsafe public content|Potential secret/u);
    }
  });

  it("removes nested inline HTML before deriving heading anchors", async () => {
    const context = await fixture(manifest(), {
      "GUIDE.md": "# Guide\n\n[Details](DETAILS.md#safe-heading).\n",
      "DETAILS.md": "# <span<em>>Safe</em> heading</span>\n",
    });
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });

    expect(publication.files.get("_generated/GUIDE.md")).toContain(
      "wiki/DETAILS#safe-heading",
    );
  });

  it("fails closed for collisions, unsafe paths, missing sources, and missing anchors", async () => {
    const duplicate = await fixture(
      manifest().replace(
        `pages:\n  - source: "*.md"\n    wiki: "{stem}"\n    visibility: public\n    order: 10`,
        `pages:\n  - source: "A.md"\n    wiki: "Same"\n    visibility: public\n    order: 10\n  - source: "B.md"\n    wiki: "same"\n    visibility: public\n    order: 20`,
      ),
      { "A.md": "# A\n", "B.md": "# B\n" },
    );
    await expect(
      buildPublication({
        manifestPath: duplicate.manifest,
        sourceRoot: duplicate.docs,
      }),
    ).rejects.toThrow(/Duplicate wiki name/u);

    const collision = await fixture(manifest("a.md"), {
      "a.md": "# A\n",
      "b.md": "# B\n",
    });
    await expect(
      buildPublication({
        manifestPath: collision.manifest,
        sourceRoot: collision.docs,
      }),
    ).rejects.toThrow(PublicationError);

    const unsafe = await fixture(
      manifest("*.md").replace('wiki: "{stem}"', 'wiki: "../{stem}"'),
      { "GUIDE.md": "# Guide\n" },
    );
    await expect(
      buildPublication({
        manifestPath: unsafe.manifest,
        sourceRoot: unsafe.docs,
      }),
    ).rejects.toThrow(/unsafe/u);

    const missing = await fixture(manifest(), {
      "GUIDE.md": "# Guide\n\n[missing](MISSING.md)\n",
    });
    await expect(
      buildPublication({
        manifestPath: missing.manifest,
        sourceRoot: missing.docs,
      }),
    ).rejects.toThrow(/Missing link source/u);

    const anchor = await fixture(manifest(), {
      "GUIDE.md": "# Guide\n\n[details](DETAILS.md#missing)\n",
      "DETAILS.md": "# Details\n",
    });
    await expect(
      buildPublication({
        manifestPath: anchor.manifest,
        sourceRoot: anchor.docs,
      }),
    ).rejects.toThrow(/Missing anchor/u);
  });

  it("detects stale generated pages, preserves reserved pages, and is idempotent", async () => {
    const context = await fixture(manifest(), { "GUIDE.md": "# Guide\n" });
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });
    const wiki = path.join(context.root, "wiki");
    await mkdir(path.join(wiki, "_generated"), { recursive: true });
    await mkdir(path.join(wiki, "_wiki-owned"), { recursive: true });
    await writeFile(path.join(wiki, "_generated", "Old.md"), "# Old\n");
    await writeFile(path.join(wiki, "_wiki-owned", "Keep.md"), "# Keep\n");
    await writeFile(
      path.join(wiki, "_generated", ".publication-manifest.json"),
      JSON.stringify({
        generatedPaths: [
          "_generated/Old.md",
          "_generated/.publication-manifest.json",
        ],
      }),
    );

    const dryRun = await publishPublication({
      publication,
      wikiRoot: wiki,
      mode: "dry-run",
      sourceSha: "test",
    });
    expect(dryRun.stale).toContain("_generated/Old.md");
    expect(dryRun.changed).toContain("_generated/Old.md");
    expect(
      await readFile(path.join(wiki, "_wiki-owned", "Keep.md"), "utf8"),
    ).toContain("Keep");

    for (const [relative, content] of publication.files) {
      const target = path.join(wiki, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await rm(path.join(wiki, "_generated", "Old.md"));
    const secondRun = await publishPublication({
      publication,
      wikiRoot: wiki,
      mode: "dry-run",
      sourceSha: "test",
    });
    expect(secondRun.changed).toEqual([]);
  });

  it("treats a case-only rename of a previously generated page as managed", async () => {
    const context = await fixture(
      manifest("GUIDE.md")
        .replace('wiki: "{stem}"', 'wiki: "Guide"')
        .replace("      - GUIDE", "      - Guide"),
      { "GUIDE.md": "# Guide\n" },
    );
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });
    const wiki = path.join(context.root, "wiki");
    await mkdir(path.join(wiki, "_generated"), { recursive: true });
    await writeFile(path.join(wiki, "_generated", "GUIDE.md"), "# Old\n");
    await writeFile(
      path.join(wiki, "_generated", ".publication-manifest.json"),
      JSON.stringify({
        generatedPaths: [
          "_generated/GUIDE.md",
          "_generated/.publication-manifest.json",
        ],
      }),
    );

    const dryRun = await publishPublication({
      publication,
      wikiRoot: wiki,
      mode: "dry-run",
      sourceSha: "test",
    });

    expect(dryRun.stale).toContain("_generated/GUIDE.md");
    expect(dryRun.changed).toContain("_generated/Guide.md");
  });

  it("requires the publication credential before publish mode", async () => {
    const context = await fixture(manifest(), { "GUIDE.md": "# Guide\n" });
    const publication = await buildPublication({
      manifestPath: context.manifest,
      sourceRoot: context.docs,
    });
    const wiki = path.join(context.root, "wiki");
    await mkdir(wiki, { recursive: true });

    await expect(
      publishPublication({
        publication,
        wikiRoot: wiki,
        mode: "publish",
        sourceSha: "test",
      }),
    ).rejects.toThrow(/WIKI_PUBLISH_TOKEN/u);
  });
});
