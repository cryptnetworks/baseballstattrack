"use client";

import { useActionState } from "react";

import {
  previewApplicationConfiguration,
  refreshApplicationConfiguration,
  rollbackApplicationConfiguration,
  saveApplicationConfiguration,
  seedApplicationConfiguration,
  type ConfigurationPreviewState,
} from "@/app/settings/configuration/actions";
import type { ApplicationConfigurationValues } from "@/domain/application-configuration";

const initialPreview: ConfigurationPreviewState = {
  outcome: "idle",
  message: "Preview validates every category without saving.",
  digest: null,
  changedCategories: [],
};

const categoryCopy = {
  IDENTITY: {
    title: "Application identity",
    description:
      "Use this non-secret identity in the application shell and operational reports.",
  },
  FEATURES: {
    title: "Feature availability",
    description: "Enable Account behavior without restarting the application.",
  },
  CALENDAR: {
    title: "Calendar display",
    description:
      "Control how much non-secret game detail calendar feeds expose.",
  },
  NOTIFICATIONS: {
    title: "Notification delivery",
    description:
      "Manage enabled destinations and non-secret SMTP or Discord transport options. Credentials remain external.",
  },
  INTEGRATIONS: {
    title: "Integration behavior",
    description:
      "Manage non-secret provider endpoints, credential references, and bounded timeouts.",
  },
  RATE_LIMITS: {
    title: "Rate-limit policies",
    description:
      "Set Account and actor quotas for every protected endpoint class.",
  },
} as const;

type HistoryEntry = Readonly<{
  id: string;
  revision: number;
  source: string;
  reason: string;
  digest: string;
  actorId: string;
  rolledBackFromRevision: number | null;
  createdAt: string;
}>;

function encodedCategories(values: ApplicationConfigurationValues) {
  return {
    IDENTITY: JSON.stringify(values.identity, null, 2),
    FEATURES: JSON.stringify(values.features, null, 2),
    CALENDAR: JSON.stringify(values.calendar, null, 2),
    NOTIFICATIONS: JSON.stringify(values.notifications, null, 2),
    INTEGRATIONS: JSON.stringify(values.integrations, null, 2),
    RATE_LIMITS: JSON.stringify(values.rateLimits, null, 2),
  };
}

export function ApplicationConfigurationEditor({
  accountId,
  canManage,
  configured,
  revision,
  values,
  history,
}: {
  accountId: string;
  canManage: boolean;
  configured: boolean;
  revision: number;
  values: ApplicationConfigurationValues;
  history: readonly HistoryEntry[];
}) {
  const [preview, previewAction, previewPending] = useActionState(
    previewApplicationConfiguration,
    initialPreview,
  );
  const categories = encodedCategories(values);

  return (
    <div className="mt-8 grid gap-8">
      {!configured ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-xl font-semibold">
            Initial configuration required
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-amber-950">
            This Account is using safe disabled defaults. Create revision 1 from
            those defaults, or import reviewed legacy non-secret environment
            values when migrating an existing deployment.
          </p>
          {canManage ? (
            <form
              action={seedApplicationConfiguration}
              className="mt-4 grid gap-3"
            >
              <input type="hidden" name="accountId" value={accountId} />
              <label className="grid max-w-2xl gap-1 text-sm font-medium">
                Migration reason
                <input
                  className="min-h-11 rounded-lg border border-amber-400 bg-white px-3"
                  name="reason"
                  required
                  minLength={8}
                  maxLength={240}
                  defaultValue="Create initial reviewed application configuration"
                />
              </label>
              <button className="min-h-11 w-fit rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white">
                Create initial revision
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <form action={previewAction} className="grid gap-6">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="expectedRevision" value={revision} />
        {(Object.keys(categoryCopy) as Array<keyof typeof categoryCopy>).map(
          (category) => (
            <section
              className="rounded-xl border border-[var(--line)] bg-white p-5"
              key={category}
              aria-labelledby={`${category}-heading`}
            >
              <p className="text-xs font-semibold tracking-wider text-[var(--accent)]">
                {category.replaceAll("_", " ")}
              </p>
              <h2
                className="mt-1 text-xl font-semibold"
                id={`${category}-heading`}
              >
                {categoryCopy[category].title}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {categoryCopy[category].description}
              </p>
              <label className="mt-4 grid gap-2 text-sm font-medium">
                Validated JSON
                <textarea
                  className="min-h-48 rounded-lg border border-[var(--line)] bg-[var(--background)] p-3 font-mono text-xs leading-5 disabled:opacity-70"
                  defaultValue={categories[category]}
                  disabled={!canManage || !configured}
                  name={category}
                  required
                  spellCheck={false}
                />
              </label>
            </section>
          ),
        )}

        <section className="rounded-xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-semibold">Review and commit</h2>
          <label className="mt-4 grid max-w-3xl gap-2 text-sm font-medium">
            Change reason
            <input
              className="min-h-11 rounded-lg border border-[var(--line)] px-3 disabled:opacity-70"
              name="reason"
              required
              minLength={8}
              maxLength={240}
              disabled={!canManage || !configured}
              placeholder="Why this operational change is required"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="min-h-11 rounded-lg border border-[var(--accent)] px-4 font-semibold text-[var(--accent-strong)] disabled:opacity-50"
              disabled={!canManage || !configured || previewPending}
              type="submit"
            >
              {previewPending ? "Validating…" : "Preview changes"}
            </button>
            <button
              className="min-h-11 rounded-lg bg-[var(--accent-strong)] px-4 font-semibold text-white disabled:opacity-50"
              disabled={!canManage || !configured}
              formAction={saveApplicationConfiguration}
            >
              Save new revision
            </button>
          </div>
          <div
            className={`mt-4 rounded-lg border p-4 text-sm ${preview.outcome === "invalid" ? "border-red-300 bg-red-50 text-red-950" : "border-[var(--line)] bg-[var(--background)]"}`}
            role={preview.outcome === "invalid" ? "alert" : "status"}
            aria-live="polite"
          >
            <p>{preview.message}</p>
            {preview.changedCategories.length ? (
              <p className="mt-1">
                Categories: {preview.changedCategories.join(", ")}
              </p>
            ) : null}
            {preview.digest ? (
              <p className="mt-1 font-mono text-xs break-all">
                {preview.digest}
              </p>
            ) : null}
          </div>
        </section>
      </form>

      <section className="rounded-xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Revision history</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Rollback creates another immutable revision; it never edits or
              deletes prior operational history.
            </p>
          </div>
          {canManage && configured ? (
            <form action={refreshApplicationConfiguration}>
              <input type="hidden" name="accountId" value={accountId} />
              <button className="min-h-11 rounded-lg border border-[var(--line)] px-4 font-semibold">
                Refresh runtime cache
              </button>
            </form>
          ) : null}
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-left text-sm">
            <caption className="sr-only">
              Application configuration revision history
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="p-3">Revision</th>
                <th className="p-3">Source</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Recorded</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr
                  className="border-b border-[var(--line)] align-top"
                  key={entry.id}
                >
                  <td className="p-3 font-semibold">{entry.revision}</td>
                  <td className="p-3">{entry.source.replaceAll("_", " ")}</td>
                  <td className="max-w-md p-3">
                    {entry.reason}
                    <span className="mt-1 block font-mono text-xs break-all text-[var(--muted)]">
                      {entry.digest}
                    </span>
                  </td>
                  <td className="p-3">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {canManage && entry.revision < revision ? (
                      <form
                        action={rollbackApplicationConfiguration}
                        className="grid gap-2"
                      >
                        <input
                          type="hidden"
                          name="accountId"
                          value={accountId}
                        />
                        <input
                          type="hidden"
                          name="expectedRevision"
                          value={revision}
                        />
                        <input
                          type="hidden"
                          name="targetRevision"
                          value={entry.revision}
                        />
                        <input
                          className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                          aria-label={`Reason to rollback to revision ${entry.revision}`}
                          name="reason"
                          required
                          minLength={8}
                          maxLength={240}
                          placeholder="Rollback reason"
                        />
                        <button className="min-h-11 rounded-lg border border-[var(--accent)] px-3 font-semibold text-[var(--accent-strong)]">
                          Roll back to {entry.revision}
                        </button>
                      </form>
                    ) : (
                      <span className="text-[var(--muted)]">
                        {entry.revision === revision ? "Current" : "Historical"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!history.length ? (
                <tr>
                  <td className="p-4 text-[var(--muted)]" colSpan={5}>
                    No configuration revisions have been recorded.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
