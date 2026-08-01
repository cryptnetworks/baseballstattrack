"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Installation = Readonly<{
  id: string;
  displayName: string | null;
  status: "PENDING" | "ACTIVE" | "DISCONNECTED" | "REVOKED";
}>;

async function retrieveInstallations(accountId: string) {
  const response = await fetch(
    `/api/admin/discord-installations?accountId=${encodeURIComponent(accountId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("unavailable");
  const body = (await response.json()) as { installations: Installation[] };
  return body.installations;
}

export function DiscordInstallationPanel({
  accountId,
  result,
}: {
  accountId: string;
  result: string | undefined;
}) {
  const [installations, setInstallations] = useState<readonly Installation[]>(
    [],
  );
  const [message, setMessage] = useState("Loading Discord connections…");
  const [busy, setBusy] = useState(false);
  const notice =
    result === "connected"
      ? "Discord connected successfully."
      : result === "cancelled"
        ? "Discord authorization was cancelled; nothing changed."
        : result === "invalid"
          ? "Discord authorization could not be verified; nothing changed."
          : result === "unavailable"
            ? "Discord is temporarily unavailable; nothing changed."
            : null;

  const load = useCallback(async () => {
    try {
      const current = await retrieveInstallations(accountId);
      setInstallations(current);
      setMessage(
        current.length
          ? "Discord connection status is current."
          : "No Discord server is connected.",
      );
    } catch {
      setMessage("Discord connections are unavailable for this account.");
    }
  }, [accountId]);

  useEffect(() => {
    let active = true;
    void retrieveInstallations(accountId)
      .then((current) => {
        if (!active) return;
        setInstallations(current);
        setMessage(
          current.length
            ? "Discord connection status is current."
            : "No Discord server is connected.",
        );
      })
      .catch(() => {
        if (active) {
          setMessage("Discord connections are unavailable for this account.");
        }
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  async function start() {
    setBusy(true);
    setMessage("Opening Discord authorization…");
    try {
      const response = await fetch("/api/admin/discord-installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", accountId }),
      });
      const body = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !body.authorizationUrl) {
        throw new Error(body.error ?? "unavailable");
      }
      window.location.assign(body.authorizationUrl);
    } catch (error) {
      setBusy(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Discord authorization is unavailable.",
      );
    }
  }

  async function disconnect(installationId: string) {
    setBusy(true);
    setMessage("Disconnecting Discord…");
    try {
      const response = await fetch("/api/admin/discord-installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disconnect",
          accountId,
          installationId,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "unavailable");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Disconnect is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="discord-installation-heading"
      className="mt-8 rounded border border-slate-200 p-4"
    >
      <h2 className="text-lg font-semibold" id="discord-installation-heading">
        Discord server connection
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Connect one server with View Channels, Send Messages, and Use
        Application Commands. Administrator permission and privileged gateway
        intents are not requested. Only a Discord server owner or manager can
        authorize it.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        The bot credential stays in the deployment secret manager and is never
        shown or stored in this page.
      </p>
      {notice ? (
        <p className="mt-3 text-sm font-medium" role="status">
          {notice}
        </p>
      ) : null}
      <p aria-live="polite" className="mt-3 text-sm font-medium">
        {message}
      </p>
      <ul className="mt-3 space-y-2">
        {installations.map((installation) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 p-3"
            key={installation.id}
          >
            <span>
              {installation.displayName ?? "Discord server"} —{" "}
              {installation.status.toLowerCase()}
            </span>
            {installation.status === "ACTIVE" ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  className="inline-flex min-h-11 items-center rounded border border-slate-400 px-4 text-sm font-medium"
                  href={`/discord/overview?server=${encodeURIComponent(installation.id)}`}
                >
                  Manage settings
                </Link>
                <button
                  className="min-h-11 rounded border border-slate-400 px-4 text-sm font-medium"
                  disabled={busy}
                  onClick={() => void disconnect(installation.id)}
                  type="button"
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        className="mt-4 min-h-11 rounded bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-60"
        disabled={busy}
        onClick={() => void start()}
        type="button"
      >
        {installations.some(({ status }) => status === "DISCONNECTED")
          ? "Reconnect Discord"
          : "Connect Discord"}
      </button>
    </section>
  );
}
