import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ScoringRecoveryBoundary } from "@/components/scoring/scoring-recovery-boundary";

describe("scoring recovery status", () => {
  it("renders an accessible, text-first authoritative save status", () => {
    const html = renderToStaticMarkup(
      createElement(ScoringRecoveryBoundary, {
        context: {
          accountId: "account-a",
          gameId: "game-a",
          setupSnapshotId: "setup-a",
          setupRevision: 1,
          sourceRevision: 12,
          acceptedSubmissionIds: [],
        },
      }),
    );
    expect(html).toContain("Save and recovery status");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Saved");
    expect(html).toContain("Authoritative revision 12");
    expect(html).toContain("No unaccepted action is stored on this device.");
  });
});
