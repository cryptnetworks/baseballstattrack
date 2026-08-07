import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActionLink,
  Breadcrumbs,
  EmptyState,
  FeedbackState,
  PageShell,
  SectionHeader,
  Surface,
} from "@/components/ui/product-primitives";

describe("product UI baseline", () => {
  it("provides semantic, composable primitives for a reference page", () => {
    const html = renderToStaticMarkup(
      <PageShell>
        <Breadcrumbs>
          <a href="/reports/season">Season reports</a> / Player
        </Breadcrumbs>
        <SectionHeader
          eyebrow="Reference"
          title="Player season summary"
          description="Verified games only"
          actions={
            <ActionLink href="/reports/season">Back to season</ActionLink>
          }
        />
        <Surface labelledBy="table-heading">
          <h2 id="table-heading">Batting</h2>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <caption>Batting line</caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">AVG</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Ada Shortstop</th>
                  <td>.333</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Surface>
        <EmptyState title="No games" description="Create a game to begin." />
        <FeedbackState tone="success">Saved</FeedbackState>
      </PageShell>,
    );

    expect(html).toContain('id="main-content"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-labelledby="table-heading"');
    expect(html).toContain('class="ui-table"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Saved");
  });

  it("keeps the shell grouped and responsive without changing route contracts", () => {
    const shell = readFileSync(
      "src/components/app/application-shell.tsx",
      "utf8",
    );
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const label of [
      "Scorekeeping",
      "Seasons",
      "Data",
      "Fantasy",
      "Operations",
      "Admin",
      "Status",
    ]) {
      expect(shell).toContain(`label=\"${label}\"`);
    }
    expect(css).toContain(".app-nav");
    expect(css).toContain(".ui-table-wrap");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("min-height: 2.75rem");
  });
});
