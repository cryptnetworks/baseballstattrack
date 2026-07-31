import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortableDataTools } from "@/components/data/portable-data-tools";
import { RouteLoading } from "@/components/ui/route-loading";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("M3 responsive performance and accessibility contract", () => {
  it("renders named, keyboard-native export and import forms", () => {
    const markup = renderToStaticMarkup(
      <PortableDataTools
        accountId="account-a"
        canExport
        canValidateImport
        maximumBytes={5 * 1024 * 1024}
      />,
    );

    expect(markup.match(/<form/g)).toHaveLength(2);
    expect(markup).toContain('for="portable-import-file"');
    expect(markup).toContain('id="portable-import-file"');
    expect(markup).toContain('aria-describedby="portable-import-help"');
    expect(markup).toContain('accept=".json,application/json"');
    expect(markup).toContain("Download JSON export");
    expect(markup).toContain("Validate without importing");
    expect(markup).toContain("Validation never writes data");
  });

  it("keeps async results focusable, announced, cancellable, and concise", () => {
    const tools = source("src/components/data/portable-data-tools.tsx");
    expect(tools).toContain("result.current?.focus()");
    expect(tools).toContain(
      'role={state.kind === "ERROR" ? "alert" : "status"}',
    );
    expect(tools).toContain('aria-live="polite"');
    expect(tools).toContain("activeRequest.current?.abort()");
    expect(tools).toContain("timed out after 30 seconds");
    expect(tools).toContain("No Account data was changed.");
    expect(tools).toContain("Error location:");
    expect(tools).not.toMatch(/dangerouslySetInnerHTML|window\.open/);
  });

  it("provides stable semantic loading feedback for slow routes", () => {
    const markup = renderToStaticMarkup(
      <RouteLoading label="Loading current report data…" />,
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('id="main-content"');
    expect(source("src/app/globals.css")).toContain(
      ".route-loading-bar {\n    transform: scaleX(1);\n    animation: none;",
    );
  });

  it("keeps reporting tables, text alternatives, and print controls semantic", () => {
    const dashboard = source("src/app/reports/season/page.tsx");
    const print = source("src/components/reports/printable-reports.tsx");
    const printAction = source("src/components/reports/print-action.tsx");

    expect(dashboard).toContain("<caption");
    expect(dashboard).toContain('scope="col"');
    expect(dashboard).toContain('scope="row"');
    expect(dashboard).toContain("Textual run totals");
    expect(dashboard).toContain("overflow-x-auto");
    expect(print).toContain("<caption");
    expect(printAction).toContain("window.print()");
    expect(printAction).toContain("Print report");
    expect(printAction).toContain('type="button"');
  });

  it("keeps portability authority separate and data code off scoring routes", () => {
    const page = source("src/app/data/page.tsx");
    const service = source("src/server/app/portable-data-service.ts");
    const scoring = source("src/app/games/score/[gameId]/page.tsx");

    expect(page).toContain('allows("report.export"');
    expect(page).toContain('allows("account.manage"');
    expect(service).toContain("loadPresentationSources");
    expect(service).not.toMatch(/Promise\.all\(\s*ready\.map/su);
    expect(scoring).not.toMatch(/portable-data|printable-reports/);
  });
});
