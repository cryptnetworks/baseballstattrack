"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

type PortableImportPlan = {
  mode: "DRY_RUN_ONLY";
  documentChecksum: string;
  counts: Record<string, number>;
  gamesReplayed: number;
  summariesMatched: number;
  conflicts: [];
  mutationCount: 0;
  confirmationRequiredBeforeFutureCommit: true;
};

type RequestState =
  | { kind: "IDLE" }
  | { kind: "PENDING"; operation: "EXPORT" | "IMPORT" }
  | { kind: "SUCCESS"; message: string; plan?: PortableImportPlan }
  | { kind: "ERROR"; message: string; location?: string };

type PortableDataToolsProps = {
  accountId: string;
  canExport: boolean;
  canValidateImport: boolean;
  maximumBytes: number;
};

const REQUEST_TIMEOUT_MILLISECONDS = 30_000;

function responseFileName(response: Response) {
  const disposition = response.headers.get("content-disposition");
  return (
    disposition?.match(/filename="([^"]+)"/u)?.[1] ??
    "baseballstattrack-export.json"
  );
}

async function responseError(response: Response) {
  const fallback = "The request could not be completed.";
  try {
    const body = (await response.json()) as {
      error?: unknown;
      location?: { section?: unknown; recordId?: unknown; field?: unknown };
    };
    const location = body.location
      ? [body.location.section, body.location.recordId, body.location.field]
          .filter((value): value is string => typeof value === "string")
          .join(" → ")
      : undefined;
    return {
      message: typeof body.error === "string" ? body.error : fallback,
      ...(location ? { location } : {}),
    };
  } catch {
    return { message: fallback };
  }
}

export function PortableDataTools({
  accountId,
  canExport,
  canValidateImport,
  maximumBytes,
}: PortableDataToolsProps) {
  const [state, setState] = useState<RequestState>({ kind: "IDLE" });
  const activeRequest = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const pending = state.kind === "PENDING";

  useEffect(() => {
    if (state.kind === "SUCCESS" || state.kind === "ERROR") {
      result.current?.focus();
    }
  }, [state]);

  function begin(operation: "EXPORT" | "IMPORT") {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ kind: "PENDING", operation });
    const timeout = window.setTimeout(() => {
      if (activeRequest.current !== controller) return;
      controller.abort();
      activeRequest.current = null;
      setState({
        kind: "ERROR",
        message:
          "The request timed out after 30 seconds. Check the connection and retry. No import changes were made.",
      });
    }, REQUEST_TIMEOUT_MILLISECONDS);
    return { controller, timeout };
  }

  function cancel() {
    const operation = state.kind === "PENDING" ? state.operation : null;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setState({
      kind: "ERROR",
      message:
        operation === "EXPORT"
          ? "The export request was cancelled. Retry when the connection is ready."
          : "Import validation was cancelled. No Account data was changed.",
    });
  }

  async function requestExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { controller, timeout } = begin("EXPORT");
    try {
      const response = await fetch(
        `/api/data/export?accountId=${encodeURIComponent(accountId)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        setState({ kind: "ERROR", ...(await responseError(response)) });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = responseFileName(response);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setState({
        kind: "SUCCESS",
        message:
          "The export download started. Store the JSON file securely; it contains Account baseball data.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState({
        kind: "ERROR",
        message: "The export request failed. Check the connection and retry.",
      });
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  async function validateImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setState({
        kind: "ERROR",
        message: "Choose a JSON export file before validation.",
      });
      return;
    }
    if (file.size > maximumBytes) {
      setState({
        kind: "ERROR",
        message: `The selected file exceeds the ${Math.floor(maximumBytes / 1024 / 1024)} MiB limit.`,
      });
      return;
    }
    const { controller, timeout } = begin("IMPORT");
    try {
      const response = await fetch(
        `/api/data/import/validate?accountId=${encodeURIComponent(accountId)}`,
        {
          method: "POST",
          body: file,
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        setState({ kind: "ERROR", ...(await responseError(response)) });
        return;
      }
      const plan = (await response.json()) as PortableImportPlan;
      setState({
        kind: "SUCCESS",
        message:
          "Validation passed. This was a dry run; no Account data was changed.",
        plan,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState({
        kind: "ERROR",
        message:
          "Import validation failed before a result was available. No Account data was changed.",
      });
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  return (
    <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-2">
      {canExport ? (
        <section
          aria-labelledby="export-heading"
          className="min-w-0 rounded-xl border border-[var(--line)] bg-white p-5"
        >
          <h2 className="text-xl font-semibold" id="export-heading">
            Export Account data
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Create a bounded, versioned JSON download from current authorized
            data. The file is not a public sharing link.
          </p>
          <form className="mt-5" onSubmit={requestExport}>
            <button
              className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-medium text-white disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              {state.kind === "PENDING" && state.operation === "EXPORT"
                ? "Preparing export…"
                : "Download JSON export"}
            </button>
          </form>
        </section>
      ) : null}

      {canValidateImport ? (
        <section
          aria-labelledby="import-heading"
          className="min-w-0 rounded-xl border border-[var(--line)] bg-white p-5"
        >
          <h2 className="text-xl font-semibold" id="import-heading">
            Validate an import
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Check a Baseball Stat Track JSON file for integrity, references,
            conflicts, and replay consistency. Validation never writes data.
          </p>
          <form className="mt-5 grid min-w-0 gap-4" onSubmit={validateImport}>
            <div className="grid min-w-0 gap-1">
              <label className="font-medium" htmlFor="portable-import-file">
                JSON export file
              </label>
              <input
                accept=".json,application/json"
                aria-describedby="portable-import-help"
                className="min-h-11 max-w-full min-w-0 rounded-lg border border-[var(--line)] bg-white px-3 py-2"
                disabled={pending}
                id="portable-import-file"
                ref={fileInput}
                required
                type="file"
              />
              <p
                className="text-sm text-[var(--muted)]"
                id="portable-import-help"
              >
                JSON only, up to {Math.floor(maximumBytes / 1024 / 1024)} MiB.
                The file remains transient and is not promoted by this workflow.
              </p>
            </div>
            <button
              className="min-h-11 justify-self-start rounded-lg bg-[var(--accent)] px-4 font-medium text-white disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              {state.kind === "PENDING" && state.operation === "IMPORT"
                ? "Validating file…"
                : "Validate without importing"}
            </button>
          </form>
        </section>
      ) : null}

      {pending ? (
        <div
          aria-atomic="true"
          aria-live="polite"
          className="rounded-xl border border-[var(--line)] bg-white p-5 lg:col-span-2"
          role="status"
        >
          <p>
            {state.operation === "EXPORT"
              ? "Preparing the authorized export…"
              : "Validating the file. No data is being changed…"}
          </p>
          <button
            className="mt-3 min-h-11 rounded-lg border border-[var(--line)] px-4 font-medium"
            onClick={cancel}
            type="button"
          >
            Cancel request
          </button>
        </div>
      ) : null}

      {state.kind === "SUCCESS" || state.kind === "ERROR" ? (
        <div
          aria-atomic="true"
          className="min-w-0 rounded-xl border border-[var(--line)] bg-white p-5 lg:col-span-2"
          ref={result}
          role={state.kind === "ERROR" ? "alert" : "status"}
          tabIndex={-1}
        >
          <p className="font-medium">{state.message}</p>
          {state.kind === "ERROR" && state.location ? (
            <p className="mt-2 text-sm break-words">
              Error location: {state.location}
            </p>
          ) : null}
          {state.kind === "SUCCESS" && state.plan ? (
            <>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--muted)]">Records checked</dt>
                  <dd>
                    {Object.values(state.plan.counts).reduce(
                      (total, count) => total + count,
                      0,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Games replayed</dt>
                  <dd>{state.plan.gamesReplayed}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Changes made</dt>
                  <dd>{state.plan.mutationCount}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs break-all text-[var(--muted)]">
                Document checksum: {state.plan.documentChecksum}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
