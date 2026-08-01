"use client";

import { useEffect, useRef } from "react";

export type DiscordSettingsFeedbackState =
  "idle" | "saving" | "saved" | "validation-error" | "failure";

type FeedbackError = Readonly<{ fieldId?: string; message: string }>;

export function DiscordSettingsFeedback({
  state,
  errors = [],
  onRetry,
}: {
  state: DiscordSettingsFeedbackState;
  errors?: readonly FeedbackError[];
  onRetry?: () => void;
}) {
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state === "validation-error" || state === "failure") {
      summary.current?.focus();
    }
  }, [state]);

  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <p aria-live="polite" className="text-sm font-medium" role="status">
        Saving changes…
      </p>
    );
  }
  if (state === "saved") {
    return (
      <p
        aria-live="polite"
        className="text-sm font-medium text-green-800"
        role="status"
      >
        Changes saved.
      </p>
    );
  }

  const validation = state === "validation-error";
  return (
    <div
      aria-labelledby="discord-settings-error-heading"
      className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-950"
      ref={summary}
      role="alert"
      tabIndex={-1}
    >
      <h2 className="font-semibold" id="discord-settings-error-heading">
        {validation
          ? "Review the highlighted settings"
          : "Changes were not saved"}
      </h2>
      <p className="mt-1 text-sm">
        {validation
          ? "Correct each item below, then save again."
          : "The settings service is unavailable. Your prior configuration is unchanged."}
      </p>
      {errors.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {errors.map((error, index) => (
            <li key={`${error.fieldId ?? "summary"}-${index}`}>
              {error.fieldId ? (
                <a className="font-medium underline" href={`#${error.fieldId}`}>
                  {error.message}
                </a>
              ) : (
                error.message
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {!validation && onRetry ? (
        <button
          className="mt-3 min-h-11 rounded-lg border border-red-400 bg-white px-4 text-sm font-semibold"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
