import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function source(relativePath: string) {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

function componentFiles(directory: string): string[] {
  return readdirSync(join(projectRoot, directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(relativePath);
    return entry.name.endsWith(".tsx") ? [relativePath] : [];
  });
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string) {
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((left, right) => right - left);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("scorekeeping accessibility contract", () => {
  it("keeps the documented application palette at WCAG 2.2 AA text contrast", () => {
    expect(contrast("#5f6b63", "#f7f7f4")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#5f6b63", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#176b4d", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#0f5138", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#162018", "#f7f7f4")).toBeGreaterThanOrEqual(4.5);
  });

  it("provides one global skip link and a focusable target on every page", () => {
    expect(source("src/app/layout.tsx")).toContain('href="#main-content"');

    const pageFiles = componentFiles("src/app").filter((path) =>
      path.endsWith("page.tsx"),
    );
    const missingTargets = pageFiles.flatMap((path) => {
      const page = source(path);
      const mainElements = [...page.matchAll(/<main\b[\s\S]*?>/g)];
      if (mainElements.length === 0) return [];
      return mainElements.every(
        ([element]) =>
          element.includes('id="main-content"') &&
          element.includes("tabIndex={-1}"),
      )
        ? []
        : [path];
    });
    expect(missingTargets).toEqual([]);
  });

  it("keeps every button at least 44 CSS pixels high by class contract", () => {
    const missingTargets = componentFiles("src").flatMap((path) => {
      const file = source(path);
      return [...file.matchAll(/<button\b[\s\S]*?>/g)].flatMap(
        ([element], index) =>
          /(?:min-h-|(?:^|\s)h-11|(?:^|\s)size-11)/.test(element)
            ? []
            : [`${path} button ${index + 1}`],
      );
    });
    expect(missingTargets).toEqual([]);
  });

  it("preserves zoom, safe areas, visible focus, and reduced motion", () => {
    const layout = source("src/app/layout.tsx");
    const css = source("src/app/globals.css");
    const appSource = componentFiles("src/app")
      .map((path) => source(path))
      .join("\n");

    expect(layout).not.toMatch(/userScalable|maximumScale/);
    expect(appSource).not.toMatch(
      /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/,
    );
    expect(css).toContain("env(safe-area-inset-left)");
    expect(css).toContain("env(safe-area-inset-right)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("exposes selected outcomes, state changes, and async errors without color alone", () => {
    const plateAppearance = source(
      "src/components/scoring/plate-appearance-panel.tsx",
    );
    const scoringPage = source("src/app/games/score/[gameId]/page.tsx");
    const asyncSurfaces = [
      "src/components/game-setup/create-game-form.tsx",
      "src/components/scoring/plate-appearance-panel.tsx",
      "src/components/scoring/runner-base-out-panel.tsx",
      "src/components/scoring/live-lineup-changes-panel.tsx",
      "src/components/scoring/scoring-recovery-boundary.tsx",
      "src/components/scoring/scoring-corrections-panel.tsx",
      "src/components/reports/box-score-verification-panel.tsx",
    ].map(source);

    expect(plateAppearance.match(/aria-pressed=/g)).toHaveLength(2);
    expect(scoringPage).toContain('aria-label="Game state"');
    expect(scoringPage).toContain('aria-live="polite"');
    expect(scoringPage).toContain("<dl");
    for (const surface of asyncSurfaces) {
      expect(surface).toContain("focus()");
      expect(surface).toMatch(/role=\{|role="(?:alert|status)"/);
    }
  });

  it("keeps responsive scorekeeping content free of fixed action bars", () => {
    const workflowSource = [
      "src/components/game-setup/game-setup-wizard.tsx",
      "src/components/scoring/plate-appearance-panel.tsx",
      "src/components/scoring/runner-base-out-panel.tsx",
      "src/components/scoring/live-lineup-changes-panel.tsx",
      "src/components/scoring/scoring-recovery-boundary.tsx",
      "src/components/scoring/scoring-corrections-panel.tsx",
      "src/app/games/[gameId]/box-score/page.tsx",
    ]
      .map(source)
      .join("\n");

    expect(workflowSource).toContain("sm:grid-cols-");
    expect(workflowSource).toContain("lg:grid-cols-");
    expect(workflowSource).toContain("overflow-x-auto");
    expect(workflowSource).not.toMatch(/\bfixed\b|\bsticky\b/);
  });

  it("keeps the complete M2 route composition connected in task order", () => {
    const setup = source("src/components/game-setup/game-setup-wizard.tsx");
    const scoring = source("src/app/games/score/[gameId]/page.tsx");
    const orderedSurfaces = [
      "<ScoringRecoveryBoundary",
      "<PlateAppearancePanel",
      "<LiveLineupChangesPanel",
      "<RunnerBaseOutPanel",
      "<ScoringCorrectionsPanel",
    ];

    expect(setup).toContain("`/games/score/${currentDraft.gameId}`");
    for (const surface of orderedSurfaces) expect(scoring).toContain(surface);
    expect(orderedSurfaces.map((surface) => scoring.indexOf(surface))).toEqual(
      [...orderedSurfaces]
        .map((surface) => scoring.indexOf(surface))
        .sort((left, right) => left - right),
    );
    expect(scoring).toContain("`/games/${gameId}/box-score`");
  });
});
