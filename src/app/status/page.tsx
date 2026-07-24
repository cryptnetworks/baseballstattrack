import { ApplicationShell } from "@/components/app/application-shell";
import { getApplicationStatus } from "@/server/app/status-service";

export default function StatusPage() {
  const status = getApplicationStatus();

  return (
    <ApplicationShell>
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-normal">Status</h1>
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
      </main>
    </ApplicationShell>
  );
}
