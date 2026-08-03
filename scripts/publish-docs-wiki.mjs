import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const DEFAULT_MANIFEST = "docs/publication-manifest.yaml";
const VISIBILITIES = new Set(["public", "internal", "restricted"]);
const SAFE_WIKI_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const LOCAL_LINK = /(!?\[[^\]]*\])\((<[^>]+>|[^)\s]+)([^)]*)\)/gu;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:ghp_|github_pat_|xox[baprs]-|sk-[A-Za-z0-9])/u,
  /^(?:WIKI_PUBLISH_TOKEN|SUPABASE_SERVICE_ROLE_KEY|DISCORD_TOKEN|CLIENT_SECRET|PRIVATE_KEY|AWS_SECRET_ACCESS_KEY)[ \t]*[:=][ \t]*(?=\S)(?!\\$|<|\$\{|your-|example|placeholder)[^\n]+/imu,
];

export class PublicationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublicationError";
  }
}

function fail(message) {
  throw new PublicationError(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function posixPath(value) {
  return value.split(path.sep).join("/");
}

function safeRelativePath(value, label) {
  const normalized = posixPath(path.posix.normalize(value));
  assert(
    normalized !== "." &&
      !normalized.startsWith("../") &&
      normalized !== ".." &&
      !normalized.startsWith("/") &&
      !normalized.includes("\\"),
    `${label} contains an unsafe path: ${value}`,
  );
  return normalized;
}

function globRegex(pattern) {
  const normalized = posixPath(pattern);
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function matches(pattern, candidate) {
  return globRegex(pattern).test(candidate);
}

async function walkFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, child)));
    } else if (entry.isFile()) {
      files.push(posixPath(child));
    }
  }
  return files;
}

async function readText(filePath, label) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function slugifyHeading(heading) {
  return heading
    .replace(/<[^>]*>/gu, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\p{Letter}\p{Number}_ -]/gu, "")
    .replace(/[ _]+/gu, "-")
    .replace(/-+/gu, "-");
}

function markdownMetadata(text, source) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  let fence = null;
  const headings = [];
  const anchors = new Map();
  for (const [lineNumber, line] of lines.entries()) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (headingMatch) {
      const textValue = headingMatch[2].trim();
      assert(
        textValue.length > 0,
        `${source}:${lineNumber + 1} has an empty heading.`,
      );
      const base = slugifyHeading(textValue);
      assert(
        base.length > 0,
        `${source}:${lineNumber + 1} has an invalid heading anchor.`,
      );
      const count = anchors.get(base) ?? 0;
      const anchor = count === 0 ? base : `${base}-${count}`;
      anchors.set(base, count + 1);
      headings.push({ level: headingMatch[1].length, text: textValue, anchor });
    }
  }
  assert(fence === null, `${source} contains an unclosed Markdown code fence.`);
  assert(
    headings.some((heading) => heading.level === 1),
    `${source} must contain an H1 title.`,
  );
  return {
    lines,
    headings,
    anchors: new Set(headings.map((heading) => heading.anchor)),
  };
}

function templateWikiName(template, source) {
  const stem = path.posix.basename(source, path.posix.extname(source));
  const value = template.replaceAll("{stem}", stem.replaceAll("_", "-"));
  assert(SAFE_WIKI_NAME.test(value), `Wiki name is unsafe: ${value}`);
  return value;
}

function validateManifestShape(manifest) {
  assert(
    manifest && typeof manifest === "object",
    "Publication manifest must be an object.",
  );
  assert(manifest.version === 1, "Publication manifest version must be 1.");
  assert(
    manifest.source?.root === "docs",
    "Publication source root must be docs.",
  );
  assert(
    manifest.publication?.publicOnly === true,
    "Publication must enforce public-only output.",
  );
  assert(
    Array.isArray(manifest.pages) && manifest.pages.length > 0,
    "Manifest pages are required.",
  );
  assert(
    Array.isArray(manifest.exclusions),
    "Manifest exclusions are required.",
  );
  assert(
    Array.isArray(manifest.navigation) && manifest.navigation.length > 0,
    "Manifest navigation is required.",
  );
  assert(
    manifest.publication.generatedDirectory &&
      manifest.publication.reservedDirectory &&
      manifest.publication.generatedManifest,
    "Manifest must define generated and reserved wiki namespaces.",
  );
  for (const bootstrap of manifest.publication.bootstrap ?? []) {
    safeRelativePath(bootstrap.path, "Bootstrap path");
    assert(
      /^[a-f0-9]{64}$/u.test(bootstrap.sha256),
      `Bootstrap hash is invalid: ${bootstrap.path}`,
    );
  }
  for (const entry of [...manifest.pages, ...manifest.exclusions]) {
    assert(
      typeof entry.source === "string",
      "Every manifest mapping needs a source pattern.",
    );
    safeRelativePath(entry.source, "Manifest source pattern");
    assert(
      VISIBILITIES.has(entry.visibility),
      `Unsupported visibility: ${entry.visibility}`,
    );
  }
  for (const group of manifest.navigation) {
    assert(
      typeof group.title === "string" && group.title.length > 0,
      "Navigation groups need titles.",
    );
    assert(
      Array.isArray(group.pages) && group.pages.length > 0,
      `Navigation group ${group.title} is empty.`,
    );
  }
}

function excludedEntry(manifest, source) {
  return (
    manifest.exclusions.find((entry) => matches(entry.source, source)) ?? null
  );
}

function expandPages(manifest, sourceFiles) {
  const pages = [];
  const seenSources = new Set();
  const seenWikiNames = new Map();
  for (const source of sourceFiles) {
    if (!source.endsWith(".md")) continue;
    const exclusion = excludedEntry(manifest, source);
    if (exclusion) continue;
    const rules = manifest.pages.filter((entry) =>
      matches(entry.source, source),
    );
    assert(
      rules.length === 1,
      `${source} must match exactly one page rule, found ${rules.length}.`,
    );
    const rule = rules[0];
    assert(
      rule.visibility === "public",
      `${source} is eligible for publication but is not public.`,
    );
    assert(
      source.endsWith(".md"),
      `${source} is not Markdown and cannot be published as a page.`,
    );
    const wiki = templateWikiName(rule.wiki, source);
    assert(!seenSources.has(source), `Duplicate source mapping: ${source}`);
    assert(!seenWikiNames.has(wiki), `Duplicate wiki name: ${wiki}`);
    const page = {
      source,
      wiki,
      visibility: rule.visibility,
      orderBy: rule.orderBy ?? "source",
    };
    pages.push(page);
    seenSources.add(source);
    seenWikiNames.set(wiki, source);
  }
  assert(pages.length > 0, "Manifest expands to no public pages.");
  pages.sort((left, right) => left.source.localeCompare(right.source));
  return pages.map((page, index) => ({ ...page, order: index + 1 }));
}

function validateNavigation(manifest, pages) {
  const available = new Set(pages.map((page) => page.wiki));
  const seen = new Set();
  const groups = manifest.navigation.map((group) => ({
    title: group.title,
    pages: [...group.pages],
  }));
  for (const group of manifest.navigation) {
    for (const wiki of group.pages) {
      assert(
        available.has(wiki),
        `Navigation references unpublished wiki page: ${wiki}`,
      );
      assert(
        !seen.has(wiki),
        `Wiki page appears in navigation more than once: ${wiki}`,
      );
      seen.add(wiki);
    }
  }
  const unlisted = [...available].filter((wiki) => !seen.has(wiki)).sort();
  if (unlisted.length > 0) {
    assert(
      manifest.publication.navigationUnlisted === "append",
      `Navigation omits public pages: ${unlisted.join(", ")}`,
    );
    groups.push({ title: "More Documentation", pages: unlisted });
  }
  return groups;
}

function isExternal(destination) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(destination);
}

function splitDestination(destination) {
  const value = destination.replace(/^<|>$/gu, "");
  const hashIndex = value.indexOf("#");
  if (hashIndex === -1) return { path: value, anchor: "" };
  return {
    path: value.slice(0, hashIndex),
    anchor: value.slice(hashIndex + 1),
  };
}

function sourceUrl(manifest, target, anchor = "") {
  const base = manifest.publication.repositoryPagesBase.replace(/\/$/u, "");
  return `${base}/${target}${anchor ? `#${anchor}` : ""}`;
}

function resolveSourcePath(source, destination) {
  const { path: destinationPath, anchor } = splitDestination(destination);
  const resolved = path.posix.normalize(
    destinationPath
      ? path.posix.join(path.posix.dirname(source), destinationPath)
      : source,
  );
  assert(
    resolved !== ".." &&
      !resolved.startsWith("../") &&
      !resolved.startsWith("/"),
    `Unsafe local link from ${source}: ${destination}`,
  );
  return { target: resolved, anchor };
}

function rewritePage(
  markdown,
  page,
  manifest,
  pageMap,
  metadataMap,
  assets,
  sourceRoot,
) {
  const metadata = metadataMap.get(page.source);
  const lines = metadata.lines;
  let fence = null;
  const output = [];
  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      output.push(line);
      continue;
    }
    if (fence !== null) {
      output.push(line);
      continue;
    }
    output.push(
      line.replace(LOCAL_LINK, (whole, label, rawDestination, suffix) => {
        const destination = rawDestination.replace(/^<|>$/gu, "");
        if (
          !destination ||
          destination.startsWith("#") ||
          isExternal(destination)
        )
          return whole;
        const { target, anchor } = resolveSourcePath(page.source, destination);
        const targetFile = path.join(sourceRoot, target);
        assert(
          existsSync(targetFile),
          `Missing link source from ${page.source}: ${target}`,
        );
        const targetMetadata = metadataMap.get(target);
        const targetPage = pageMap.get(target);
        if (targetMetadata && targetPage) {
          if (anchor) {
            assert(
              targetMetadata.anchors.has(anchor),
              `Missing anchor from ${page.source}: ${target}#${anchor}`,
            );
          }
          const rewritten = `./${targetPage.wiki}.md${anchor ? `#${anchor}` : ""}`;
          return `${label}(${rewritten}${suffix})`;
        }
        if (path.posix.extname(target).toLowerCase() === ".md") {
          const exclusion = excludedEntry(manifest, target);
          assert(exclusion, `Unmapped Markdown source: ${target}`);
          if (anchor && targetMetadata) {
            assert(
              targetMetadata.anchors.has(anchor),
              `Missing anchor from ${page.source}: ${target}#${anchor}`,
            );
          }
          assert(
            manifest.publication.excludedLinkPolicy === "repository",
            `Public page links to non-public source: ${target}`,
          );
          return `${label}(${sourceUrl(manifest, target, anchor)}${suffix})`;
        }
        const relativeAsset = safeRelativePath(target, "Linked asset");
        const assetPath = path.join(sourceRoot, relativeAsset);
        assert(
          existsSync(assetPath),
          `Missing linked asset from ${page.source}: ${target}`,
        );
        if (!/\.(?:gif|jpe?g|png|svg|webp|ico)$/iu.test(relativeAsset)) {
          return `${label}(${sourceUrl(manifest, relativeAsset, anchor)}${suffix})`;
        }
        const assetName = path.posix.basename(relativeAsset);
        assert(
          !assets.has(assetName) || assets.get(assetName) === assetPath,
          `Asset collision: ${assetName}`,
        );
        assets.set(assetName, assetPath);
        return `${label}(./assets/${assetName}${suffix})`;
      }),
    );
  }
  assert(
    fence === null,
    `${page.source} has an unclosed code fence after rewriting.`,
  );
  return `${output.join("\n").trimEnd()}\n`;
}

function landingPage(manifest, navigation) {
  const lines = [
    "# Baseball Stat Track Documentation",
    "",
    "This page is generated from the repository's `docs/` directory.",
    "The repository documentation is authoritative; direct wiki edits are not.",
    "",
  ];
  for (const group of navigation) {
    lines.push(`## ${group.title}`, "");
    for (const wiki of group.pages)
      lines.push(`- [${wiki}](./_generated/${wiki}.md)`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function sidebar(navigation) {
  const lines = ["### Baseball Stat Track", "", "- [Home](./Home.md)"];
  for (const group of navigation) {
    lines.push("", `#### ${group.title}`);
    for (const wiki of group.pages) {
      lines.push(`- [${wiki}](./_generated/${wiki}.md)`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  const text = await readText(manifestPath, "publication manifest");
  let manifest;
  try {
    manifest = parse(text);
  } catch (error) {
    fail(`Publication manifest is invalid YAML: ${error.message}`);
  }
  validateManifestShape(manifest);
  return manifest;
}

export async function buildPublication({
  manifestPath = DEFAULT_MANIFEST,
  sourceRoot = "docs",
} = {}) {
  const manifest = await loadManifest(manifestPath);
  const sourceFiles = await walkFiles(sourceRoot);
  const pages = expandPages(manifest, sourceFiles);
  const navigation = validateNavigation(manifest, pages);
  const pageMap = new Map(pages.map((page) => [page.source, page]));
  const metadataMap = new Map();
  for (const source of sourceFiles.filter((file) => file.endsWith(".md"))) {
    const markdown = await readText(path.join(sourceRoot, source), source);
    assert(!markdown.includes("\0"), `${source} contains a NUL byte.`);
    for (const pattern of SECRET_PATTERNS)
      assert(!pattern.test(markdown), `Potential secret in ${source}.`);
    metadataMap.set(source, markdownMetadata(markdown, source));
  }
  const assets = new Map();
  const files = new Map();
  for (const page of pages) {
    const markdown = await readText(
      path.join(sourceRoot, page.source),
      page.source,
    );
    const rewritten = rewritePage(
      markdown,
      page,
      manifest,
      pageMap,
      metadataMap,
      assets,
      sourceRoot,
    );
    files.set(
      `${manifest.publication.generatedDirectory}/${page.wiki}.md`,
      rewritten,
    );
  }
  for (const [assetName, assetPath] of assets) {
    files.set(
      `${manifest.publication.generatedDirectory}/assets/${assetName}`,
      await readFile(assetPath),
    );
  }
  files.set(
    manifest.publication.landingPage,
    landingPage(manifest, navigation),
  );
  files.set(manifest.publication.sidebarPage, sidebar(navigation));
  const generatedManifestPath = manifest.publication.generatedManifest;
  files.set(
    generatedManifestPath,
    `${JSON.stringify(
      {
        manifestVersion: manifest.version,
        generatedPaths: [...files.keys(), generatedManifestPath].sort(),
        sourceFiles: pages.map(({ source, wiki, order, visibility }) => ({
          source,
          wiki,
          order,
          visibility,
        })),
      },
      null,
      2,
    )}\n`,
  );
  return { manifest, pages, files };
}

async function wikiState(wikiRoot, manifest) {
  assert(wikiRoot, "A wiki directory is required for dry-run or publish mode.");
  const root = path.resolve(wikiRoot);
  const rootStats = await stat(root).catch(() => null);
  assert(rootStats?.isDirectory(), `Wiki directory does not exist: ${root}`);
  const generatedManifest = path.join(
    root,
    manifest.publication.generatedManifest,
  );
  if (!existsSync(generatedManifest)) return { root, previousPaths: [] };
  let previous;
  try {
    previous = JSON.parse(await readFile(generatedManifest, "utf8"));
  } catch (error) {
    fail(`Generated wiki manifest is invalid: ${error.message}`);
  }
  assert(
    Array.isArray(previous.generatedPaths),
    "Generated wiki manifest is missing generatedPaths.",
  );
  for (const value of previous.generatedPaths) {
    safeRelativePath(value, "Previous generated wiki path");
    assert(
      !value.startsWith(`${manifest.publication.reservedDirectory}/`),
      "Generated manifest claims reserved content.",
    );
  }
  return { root, previousPaths: previous.generatedPaths };
}

async function findFiles(root, relative = "") {
  if (!existsSync(path.join(root, relative))) return [];
  return walkFiles(root, relative);
}

async function comparePublication(publication, state) {
  const desired = new Map(publication.files);
  const previous = new Set(state.previousPaths);
  const existingGenerated = new Set(
    await findFiles(
      state.root,
      publication.manifest.publication.generatedDirectory,
    ),
  );
  const desiredPaths = new Set(desired.keys());
  for (const existing of existingGenerated) {
    assert(
      previous.has(existing),
      `Untracked file in generated namespace: ${existing}`,
    );
  }
  for (const desiredPath of desiredPaths) {
    assert(
      !desiredPath.startsWith(
        `${publication.manifest.publication.reservedDirectory}/`,
      ) && desiredPath !== publication.manifest.publication.reservedDirectory,
      `Generated output overlaps reserved wiki content: ${desiredPath}`,
    );
    if (
      existsSync(path.join(state.root, desiredPath)) &&
      !previous.has(desiredPath)
    ) {
      const bootstrap = (publication.manifest.publication.bootstrap ?? []).find(
        (entry) => entry.path === desiredPath,
      );
      const current = await readFile(path.join(state.root, desiredPath));
      const currentHash = createHash("sha256").update(current).digest("hex");
      assert(
        bootstrap && currentHash === bootstrap.sha256,
        `Generated output collides with unmanaged wiki content: ${desiredPath}`,
      );
    }
  }
  const stale = [...previous].filter((value) => !desiredPaths.has(value));
  const changed = [];
  for (const [relative, content] of desired) {
    const existingPath = path.join(state.root, relative);
    const existing = existsSync(existingPath)
      ? await readFile(existingPath)
      : null;
    const expected = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!existing || !existing.equals(expected)) changed.push(relative);
  }
  for (const relative of stale) {
    assert(
      existsSync(path.join(state.root, relative)),
      `Generated manifest references missing file: ${relative}`,
    );
    changed.push(relative);
  }
  return { desired, stale, changed: [...new Set(changed)].sort() };
}

function printDiff(publication, comparison, state) {
  if (comparison.changed.length === 0) {
    console.log(
      "Documentation wiki dry run: no changes; publication is idempotent.",
    );
    return;
  }
  console.log(
    `Documentation wiki dry run: ${comparison.changed.length} changed path(s).`,
  );
  for (const relative of comparison.changed) {
    const currentPath = path.join(state.root, relative);
    const desired = publication.files.get(relative);
    if (desired === undefined) {
      console.log(
        `diff --git a/${relative} /dev/null\n--- a/${relative}\n+++ /dev/null`,
      );
      continue;
    }
    const before = existsSync(currentPath) ? readFileSyncSafe(currentPath) : "";
    const after = Buffer.isBuffer(desired) ? desired.toString("utf8") : desired;
    if (before === after) continue;
    console.log(`diff --git a/${relative} b/${relative}`);
    console.log(`--- a/${relative}\n+++ b/${relative}`);
    for (const line of before.split("\n")) if (line) console.log(`-${line}`);
    for (const line of after.split("\n")) if (line) console.log(`+${line}`);
  }
}

function readFileSyncSafe(filePath) {
  return readFileSync(filePath, "utf8");
}

async function writePublication(publication, comparison, state) {
  for (const [relative, content] of publication.files) {
    const target = path.join(state.root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  for (const relative of comparison.stale)
    await rm(path.join(state.root, relative), { force: true });
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`Wiki git operation failed: ${detail}`);
  }
}

export async function publishPublication({
  publication,
  wikiRoot,
  mode,
  sourceSha,
  targetBranch = "main",
}) {
  const state = await wikiState(wikiRoot, publication.manifest);
  const comparison = await comparePublication(publication, state);
  if (mode === "dry-run") {
    printDiff(publication, comparison, state);
    return { ...comparison, committed: false };
  }
  assert(mode === "publish", `Unsupported publication mode: ${mode}`);
  assert(
    process.env.WIKI_PUBLISH_TOKEN,
    "WIKI_PUBLISH_TOKEN is required for publish mode.",
  );
  if (comparison.changed.length === 0) {
    console.log(
      "Documentation wiki publish: no changes; no commit or push created.",
    );
    return { ...comparison, committed: false };
  }
  assert(
    git(state.root, ["status", "--porcelain"]) === "",
    "Wiki workspace has uncommitted changes.",
  );
  await writePublication(publication, comparison, state);
  git(state.root, ["add", "--", ...comparison.changed]);
  git(state.root, ["commit", "-m", `docs: publish wiki from ${sourceSha}`]);
  git(state.root, ["push", "origin", `HEAD:${targetBranch}`]);
  console.log(
    `Documentation wiki publish: committed and pushed ${comparison.changed.length} changed path(s).`,
  );
  return { ...comparison, committed: true };
}

function argsFrom(argv) {
  const args = {
    mode: "validate",
    manifest: DEFAULT_MANIFEST,
    sourceRoot: "docs",
    wikiRoot: null,
    sourceSha: "local",
    targetBranch: "main",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--mode") args.mode = argv[++index];
    else if (value === "--manifest") args.manifest = argv[++index];
    else if (value === "--source-root") args.sourceRoot = argv[++index];
    else if (value === "--wiki-dir") args.wikiRoot = argv[++index];
    else if (value === "--source-sha") args.sourceSha = argv[++index];
    else if (value === "--target-branch") args.targetBranch = argv[++index];
    else fail(`Unknown argument: ${value}`);
  }
  assert(
    ["validate", "dry-run", "publish"].includes(args.mode),
    `Unsupported mode: ${args.mode}`,
  );
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsFrom(argv);
  const publication = await buildPublication({
    manifestPath: args.manifest,
    sourceRoot: args.sourceRoot,
  });
  if (args.mode === "validate") {
    console.log(
      `Documentation publication manifest validated: ${publication.pages.length} public page(s).`,
    );
    return publication;
  }
  return publishPublication({
    ...args,
    publication,
    mode: args.mode,
    wikiRoot: args.wikiRoot,
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Documentation wiki publication failed: ${error.message}`);
    process.exitCode = 1;
  });
}
