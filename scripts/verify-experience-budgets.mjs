import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

const routes = [
  {
    route: "Application shell",
    manifest: "page",
    rawBudget: 120_000,
    gzipBudget: 35_000,
  },
  {
    route: "Game setup index",
    manifest: "games/setup/page",
    rawBudget: 460_000,
    gzipBudget: 120_000,
  },
  {
    route: "Game setup editor",
    manifest: "games/setup/[gameId]/page",
    rawBudget: 460_000,
    gzipBudget: 120_000,
  },
  {
    route: "Live scoring",
    manifest: "games/score/[gameId]/page",
    rawBudget: 1_050_000,
    gzipBudget: 285_000,
  },
  {
    route: "Box score",
    manifest: "games/[gameId]/box-score/page",
    rawBudget: 125_000,
    gzipBudget: 35_000,
  },
  {
    route: "Season dashboard",
    manifest: "reports/season/page",
    rawBudget: 125_000,
    gzipBudget: 35_000,
  },
  {
    route: "Player summary",
    manifest: "reports/season/players/[playerId]/page",
    rawBudget: 125_000,
    gzipBudget: 35_000,
  },
  {
    route: "Printable season report",
    manifest: "reports/season/print/page",
    rawBudget: 125_000,
    gzipBudget: 35_000,
  },
  {
    route: "Portable data tools",
    manifest: "data/page",
    rawBudget: 400_000,
    gzipBudget: 110_000,
  },
];

function manifestFor(path) {
  const source = readFileSync(
    `.next/server/app/${path}_client-reference-manifest.js`,
    "utf8",
  );
  const match = source.match(/ = (\{.*\});\s*$/su);
  if (!match) throw new Error(`Could not parse the ${path} client manifest.`);
  return JSON.parse(match[1]);
}

function clientChunks(manifest) {
  return new Set(
    Object.values(manifest.clientModules)
      .flatMap(({ chunks }) => chunks)
      .filter((chunk) => chunk.startsWith("/_next/static/chunks/")),
  );
}

function measure(chunks) {
  let raw = 0;
  let gzip = 0;
  for (const chunk of chunks) {
    const bytes = readFileSync(`.next/${chunk.replace("/_next/", "")}`);
    raw += bytes.byteLength;
    gzip += gzipSync(bytes).byteLength;
  }
  return { raw, gzip };
}

const failures = [];
const results = routes.map((budget) => {
  const manifest = manifestFor(budget.manifest);
  const chunks = clientChunks(manifest);
  const measured = measure(chunks);
  if (measured.raw > budget.rawBudget) {
    failures.push(
      `${budget.route} raw JavaScript ${measured.raw} exceeds ${budget.rawBudget}.`,
    );
  }
  if (measured.gzip > budget.gzipBudget) {
    failures.push(
      `${budget.route} gzip JavaScript ${measured.gzip} exceeds ${budget.gzipBudget}.`,
    );
  }
  return {
    Route: budget.route,
    "Raw bytes": measured.raw,
    "Raw budget": budget.rawBudget,
    "Gzip bytes": measured.gzip,
    "Gzip budget": budget.gzipBudget,
  };
});

const scoringManifest = readFileSync(
  ".next/server/app/games/score/[gameId]/page_client-reference-manifest.js",
  "utf8",
);
for (const prohibited of [
  "portable-data-tools",
  "printable-reports",
  "season-dashboard",
  "@tanstack/react-query",
]) {
  if (scoringManifest.includes(prohibited)) {
    failures.push(`Live scoring eagerly includes ${prohibited}.`);
  }
}

const cssManifest = manifestFor("page");
const cssFiles = new Set(
  Object.values(cssManifest.entryCSSFiles)
    .flat()
    .map(({ path }) => path),
);
const cssBytes = [...cssFiles].reduce(
  (total, path) => total + statSync(`.next/${path}`).size,
  0,
);
if (cssBytes > 80_000) {
  failures.push(`Application CSS ${cssBytes} exceeds 80000 raw bytes.`);
}

console.table(results);
console.log(`Application CSS: ${cssBytes} raw bytes (budget 80000).`);
if (failures.length > 0) {
  throw new Error(`Experience budgets failed:\n- ${failures.join("\n- ")}`);
}
console.log("Experience bundle and route-isolation budgets passed.");
