import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { ApplicationConfigurationEditor } from "@/components/configuration/application-configuration-editor";
import { getApplicationConfigurationService } from "@/server/app/application-configuration-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export default async function ApplicationConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  const search = await searchParams;
  const identity = await authenticatePageSession();
  const authorization = getAuthorizationService();
  let viewActor;
  try {
    viewActor = await authorization.authorize(
      identity,
      { kind: "ACCOUNT", accountId },
      "configuration.view",
    );
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/accounts");
    throw error;
  }

  let canManage = false;
  try {
    await authorization.authorize(
      identity,
      { kind: "ACCOUNT", accountId },
      "configuration.manage",
    );
    canManage = true;
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
  }

  let workspace;
  try {
    workspace = await getApplicationConfigurationService().view(
      accountId,
      viewActor,
    );
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/accounts");
    throw error;
  }

  const current = workspace.current;
  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <p className="text-sm font-semibold text-[var(--accent-strong)]">
          Administration
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          Application configuration
        </h1>
        <p className="mt-2 max-w-3xl text-[var(--muted)]">
          Manage non-secret Account behavior through validated, versioned
          revisions. Credentials and infrastructure settings never appear in
          this portal.
        </p>
        {search.notice ? (
          <p
            className="mt-5 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-950"
            role="status"
          >
            {search.notice}
          </p>
        ) : null}
        {search.error ? (
          <p
            className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950"
            role="alert"
          >
            {search.error}
          </p>
        ) : null}
        {!canManage ? (
          <p className="mt-5 rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm">
            This configuration is read-only. Account administrator permission is
            required to preview, save, refresh, seed, or roll back.
          </p>
        ) : null}
        <ApplicationConfigurationEditor
          accountId={accountId}
          canManage={canManage}
          configured={current !== null}
          revision={current?.currentRevision ?? 0}
          values={current?.values ?? workspace.defaults}
          history={workspace.history.map((entry) => ({
            id: entry.externalId,
            revision: entry.revision,
            source: entry.source,
            reason: entry.reason,
            digest: entry.digest,
            actorId: entry.actorId,
            rolledBackFromRevision: entry.rolledBackFromRevision,
            createdAt: entry.createdAt.toISOString(),
          }))}
        />
      </main>
    </ApplicationShell>
  );
}
