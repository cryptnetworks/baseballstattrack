"use client";

import { useEffect } from "react";

import { ApplicationShell } from "@/components/app/application-shell";
import { DiscordSettingsFeedback } from "@/components/discord/discord-settings-feedback";

export default function DiscordSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is intentionally not shown or logged in the browser.
    void error.digest;
  }, [error]);

  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="text-3xl font-semibold">Discord settings</h1>
        <div className="mt-6">
          <DiscordSettingsFeedback onRetry={reset} state="failure" />
        </div>
      </main>
    </ApplicationShell>
  );
}
