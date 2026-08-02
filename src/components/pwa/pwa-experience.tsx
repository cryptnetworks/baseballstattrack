"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_INSTALL_PROMPT_KEY =
  "baseballstattrack:pwa-install-prompt-dismissed";

export type ConnectivityState =
  "connected" | "degraded" | "disconnected" | "reconnecting";

type NetworkConnection = EventTarget & {
  downlink?: number;
  effectiveType?: string;
  saveData?: boolean;
};

export type NetworkSnapshot = {
  degraded: boolean;
  online: boolean;
};

export type ServerReachability = "confirmed" | "checking" | "failed";

function browserConnection() {
  return (navigator as Navigator & { connection?: NetworkConnection })
    .connection;
}

export function connectionStateFromSnapshot(
  snapshot: NetworkSnapshot,
): Exclude<ConnectivityState, "reconnecting"> {
  if (!snapshot.online) return "disconnected";
  return snapshot.degraded ? "degraded" : "connected";
}

export function connectionStateWithReachability(
  snapshot: NetworkSnapshot,
  reachability: ServerReachability,
): ConnectivityState {
  const baseline = connectionStateFromSnapshot(snapshot);
  if (baseline === "disconnected") return baseline;
  if (reachability === "checking") return "reconnecting";
  if (reachability === "failed") return "degraded";
  return baseline;
}

function networkSnapshot() {
  const connection = browserConnection();
  const effectiveType = connection?.effectiveType;
  const degraded =
    connection?.saveData === true ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    (typeof connection?.downlink === "number" && connection.downlink < 1);

  return `${navigator.onLine ? "online" : "offline"}:${degraded ? "degraded" : "normal"}`;
}

function serverNetworkSnapshot() {
  return "connected" as const;
}

function parseNetworkSnapshot(snapshot: string): NetworkSnapshot {
  return {
    online: snapshot.startsWith("online:"),
    degraded: snapshot.endsWith(":degraded"),
  };
}

const connectivitySubscribers = new Set<() => void>();
let reconnecting = false;
let serverReachabilityFailed = false;
let previouslyOnline = true;
let reconnectController: AbortController | null = null;

function emitConnectivityChange() {
  for (const subscriber of connectivitySubscribers) subscriber();
}

function currentConnectivityState(): ConnectivityState {
  const reachability: ServerReachability = reconnecting
    ? "checking"
    : serverReachabilityFailed
      ? "failed"
      : "confirmed";
  return connectionStateWithReachability(
    parseNetworkSnapshot(networkSnapshot()),
    reachability,
  );
}

function confirmServerReachability() {
  reconnectController?.abort();
  const controller = new AbortController();
  reconnectController = controller;
  reconnecting = true;
  serverReachabilityFailed = false;
  emitConnectivityChange();

  void fetch("/api/health", {
    cache: "no-store",
    credentials: "same-origin",
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error("Health check failed");
      reconnecting = false;
      emitConnectivityChange();
    })
    .catch(() => {
      if (controller.signal.aborted) return;
      reconnecting = false;
      serverReachabilityFailed = true;
      emitConnectivityChange();
    });
}

function handleConnectivitySignal() {
  if (!navigator.onLine) {
    previouslyOnline = false;
    reconnecting = false;
    serverReachabilityFailed = false;
    reconnectController?.abort();
    emitConnectivityChange();
    return;
  }

  if (!previouslyOnline) {
    previouslyOnline = true;
    confirmServerReachability();
    return;
  }

  emitConnectivityChange();
}

function recheckFailedReachability() {
  if (
    navigator.onLine &&
    serverReachabilityFailed &&
    document.visibilityState !== "hidden"
  ) {
    confirmServerReachability();
  }
}

function subscribeToOnlineStatus(callback: () => void) {
  connectivitySubscribers.add(callback);

  if (connectivitySubscribers.size === 1) {
    previouslyOnline = navigator.onLine;
    window.addEventListener("online", handleConnectivitySignal);
    window.addEventListener("offline", handleConnectivitySignal);
    window.addEventListener("focus", recheckFailedReachability);
    document.addEventListener("visibilitychange", recheckFailedReachability);
    browserConnection()?.addEventListener("change", handleConnectivitySignal);
  }

  return () => {
    connectivitySubscribers.delete(callback);
    if (connectivitySubscribers.size > 0) return;

    window.removeEventListener("online", handleConnectivitySignal);
    window.removeEventListener("offline", handleConnectivitySignal);
    window.removeEventListener("focus", recheckFailedReachability);
    document.removeEventListener("visibilitychange", recheckFailedReachability);
    browserConnection()?.removeEventListener(
      "change",
      handleConnectivitySignal,
    );
    reconnectController?.abort();
    reconnectController = null;
    reconnecting = false;
    serverReachabilityFailed = false;
  };
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

const connectionMessage: Record<ConnectivityState, string> = {
  connected: "Online · server-authoritative",
  degraded:
    "Connection degraded. Server saves may take longer. Confirm each action before continuing.",
  disconnected:
    "Connection interrupted. Your saved server state remains authoritative. Wait for reconnection before saving new scoring actions.",
  reconnecting:
    "Reconnecting to the server. Wait for confirmation before saving new scoring actions.",
};

function ConnectionStatus({ state }: { state: ConnectivityState }) {
  return (
    <div
      className={`pwa-connection-status pwa-connection-status--${state}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span aria-hidden="true" className="pwa-connection-status__dot" />
      <span>{connectionMessage[state]}</span>
    </div>
  );
}

function useConnectivityState() {
  return useSyncExternalStore(
    subscribeToOnlineStatus,
    currentConnectivityState,
    serverNetworkSnapshot,
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
  const connectivity = useConnectivityState();
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
      <ConnectionStatus state={connectivity} />
      {installEvent ? (
        <InstallPrompt
          installEvent={installEvent}
          onDismiss={dismissInstallPrompt}
        />
      ) : null}
    </>
  );
}
