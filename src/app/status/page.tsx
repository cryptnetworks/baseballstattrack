import { ApplicationShell } from "@/components/app/application-shell";
import {
  PageShell,
  SectionHeader,
  Surface,
} from "@/components/ui/product-primitives";
import { getApplicationStatus } from "@/server/app/status-service";

export default function StatusPage() {
  const status = getApplicationStatus();

  return (
    <ApplicationShell>
      <PageShell>
        <SectionHeader
          eyebrow="Operations"
          title="Service status"
          description="A concise view of the runtime and the event source used by this workspace."
        />
        <dl className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
            <dt className="text-sm font-medium text-[var(--muted)]">Health</dt>
            <dd className="mt-2 text-2xl font-semibold">{status.status}</dd>
          </div>
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Environment
            </dt>
            <dd className="mt-2 text-2xl font-semibold">
              {status.environment}
            </dd>
          </div>
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
            <dt className="text-sm font-medium text-[var(--muted)]">
              Event Source
            </dt>
            <dd className="mt-2 text-2xl font-semibold">
              {status.eventSource}
            </dd>
          </div>
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
            <dt className="text-sm font-medium text-[var(--muted)]">Version</dt>
            <dd className="mt-2 text-2xl font-semibold">{status.version}</dd>
          </div>
        </dl>
        <Surface className="mt-6">
          <h2 className="text-lg font-semibold">What this means</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Health describes the application process. Event source identifies
            the authoritative source used to derive score and statistic views;
            it is not a replacement for game verification.
          </p>
        </Surface>
      </PageShell>
    </ApplicationShell>
  );
}
