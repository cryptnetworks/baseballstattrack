import Link from "next/link";

import { ApplicationShell } from "@/components/app/application-shell";
import {
  ActionLink,
  PageShell,
  SectionHeader,
  Surface,
} from "@/components/ui/product-primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { getApplicationStatus } from "@/server/app/status-service";

export default function HomePage() {
  const status = getApplicationStatus();

  return (
    <ApplicationShell>
      <PageShell>
        <SectionHeader
          eyebrow="Baseball operations"
          title="Operations overview"
          description="Move from first pitch to verified reference data with a clear path through every baseball workflow."
          actions={<StatusBadge status={status.status} />}
        />

        <section aria-labelledby="start-heading" className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold" id="start-heading">
                Start where the work is
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Frequent operator actions, kept close to the surface.
              </p>
            </div>
            <Link
              className="text-sm font-semibold text-[var(--accent-strong)] underline"
              href="/accounts"
            >
              Change account
            </Link>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Surface
              as="article"
              className="flex flex-col justify-between gap-6"
            >
              <div>
                <p className="ui-kicker">Scorekeeping</p>
                <h3 className="text-lg font-semibold">
                  Set up or resume a game
                </h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Prepare lineups, confirm teams, and enter the live scoring
                  workspace.
                </p>
              </div>
              <ActionLink href="/games/setup" variant="primary">
                Open game setup
              </ActionLink>
            </Surface>
            <Surface
              as="article"
              className="flex flex-col justify-between gap-6"
            >
              <div>
                <p className="ui-kicker">Reference</p>
                <h3 className="text-lg font-semibold">Review a season</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Scan verified records, qualified leaders, player pages, and
                  recent games.
                </p>
              </div>
              <ActionLink href="/reports/season" variant="secondary">
                Open season reports
              </ActionLink>
            </Surface>
            <Surface
              as="article"
              className="flex flex-col justify-between gap-6"
            >
              <div>
                <p className="ui-kicker">Data &amp; administration</p>
                <h3 className="text-lg font-semibold">
                  Maintain the workspace
                </h3>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Manage configuration, exports, integrations, and operational
                  health.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionLink href="/data" variant="secondary">
                  Data tools
                </ActionLink>
                <ActionLink href="/settings/configuration" variant="quiet">
                  Admin
                </ActionLink>
              </div>
            </Surface>
          </div>
        </section>

        <section aria-labelledby="trust-heading" className="mt-8">
          <Surface className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="ui-kicker">Trust and provenance</p>
              <h2 className="text-xl font-semibold" id="trust-heading">
                The event ledger is authoritative
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Scores, box scores, and statistics are derived from replayable
                game events. Verified status and source context stay visible so
                a coach, scorekeeper, or statistician can understand what they
                are reading.
              </p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-3 md:grid-cols-1">
              <div className="border-l-2 border-[var(--accent)] pl-3">
                <dt className="text-[var(--muted)]">Health</dt>
                <dd className="mt-1 font-semibold">{status.status}</dd>
              </div>
              <div className="border-l-2 border-[var(--line-strong)] pl-3">
                <dt className="text-[var(--muted)]">Environment</dt>
                <dd className="mt-1 font-semibold">{status.environment}</dd>
              </div>
              <div className="border-l-2 border-[var(--line-strong)] pl-3">
                <dt className="text-[var(--muted)]">Event source</dt>
                <dd className="mt-1 font-semibold">{status.eventSource}</dd>
              </div>
            </dl>
          </Surface>
        </section>
      </PageShell>
    </ApplicationShell>
  );
}
