"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_INSTALL_PROMPT_KEY =
  "baseballstattrack:pwa-install-prompt-dismissed";

function subscribeToOnlineStatus(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineStatus() {
  return window.navigator.onLine;
}

function isStandaloneDisplayMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      Boolean(
        (window.navigator as Navigator & { standalone?: boolean }).standalone,
      ))
  );
}

function ConnectionStatus({ online }: { online: boolean }) {
  return (
    <div
      className={`pwa-connection-status ${online ? "pwa-connection-status--online" : "pwa-connection-status--offline"}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span aria-hidden="true" className="pwa-connection-status__dot" />
      <span>
        {online
          ? "Online · server-authoritative"
          : "Connection interrupted. Your saved server state remains authoritative. Wait for reconnection before saving new scoring actions."}
      </span>
    </div>
  );
}

function InstallPrompt({
  installEvent,
  onDismiss,
}: {
  installEvent: BeforeInstallPromptEvent;
  onDismiss: () => void;
}) {
  const [installing, setInstalling] = useState(false);

  async function install() {
    setInstalling(true);
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
      onDismiss();
    } catch {
      // The browser may withdraw the prompt; leave the affordance available.
    } finally {
      setInstalling(false);
    }
  }

  return (
    <aside className="pwa-install-prompt" aria-labelledby="pwa-install-title">
      <div>
        <p id="pwa-install-title" className="font-semibold">
          Install Stat Track
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Add the online-first scorekeeping experience to your home screen.
        </p>
      </div>
      <div className="pwa-install-prompt__actions">
        <button
          className="pwa-install-prompt__install min-h-11"
          type="button"
          onClick={() => void install()}
          disabled={installing}
        >
          {installing ? "Installing…" : "Install"}
        </button>
        <button
          className="pwa-install-prompt__dismiss min-h-11"
          type="button"
          onClick={onDismiss}
          disabled={installing}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}

export function PwaExperience() {
  const online = useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineStatus,
    () => true,
  );
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      let dismissed = false;
      try {
        dismissed =
          window.localStorage.getItem(DISMISSED_INSTALL_PROMPT_KEY) === "true";
      } catch {
        // A browser storage policy should not block the install affordance.
      }
      if (isStandaloneDisplayMode() || dismissed) return;
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/service-worker.js", { scope: "/" })
        .catch(() => undefined);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  function dismissInstallPrompt() {
    try {
      window.localStorage.setItem(DISMISSED_INSTALL_PROMPT_KEY, "true");
    } catch {
      // A browser storage policy should not block dismissing the prompt.
    }
    setInstallEvent(null);
  }

  return (
    <>
      <ConnectionStatus online={online} />
      {installEvent ? (
        <InstallPrompt
          installEvent={installEvent}
          onDismiss={dismissInstallPrompt}
        />
      ) : null}
    </>
  );
}
