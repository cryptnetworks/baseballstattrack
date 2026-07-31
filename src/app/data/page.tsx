import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { PortableDataTools } from "@/components/data/portable-data-tools";
import { MAX_PORTABLE_BYTES } from "@/domain/portable-data";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";
import type { Capability } from "@/server/auth/types";

export const dynamic = "force-dynamic";

async function allows(
  capability: Capability,
  accountId: string,
  identity: Awaited<ReturnType<typeof authenticatePageSession>>,
) {
  try {
    await getAuthorizationService().authorize(
      identity,
      { kind: "ACCOUNT", accountId },
      capability,
    );
    return true;
  } catch (error) {
    if (
      error instanceof AuthorizationError &&
      [
        "INSUFFICIENT_CAPABILITY",
        "NO_ACTIVE_MEMBERSHIP",
        "ACCOUNT_UNAVAILABLE",
      ].includes(error.code)
    ) {
      return false;
    }
    throw error;
  }
}

export default async function PortableDataPage() {
  const accountId = (await cookies()).get(selectedAccountCookie.name)?.value;
  if (!accountId) redirect("/accounts");
  let identity;
  try {
    identity = await authenticatePageSession();
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/login");
    throw error;
  }
  const [canExport, canValidateImport] = await Promise.all([
    allows("report.export", accountId, identity),
    allows("account.manage", accountId, identity),
  ]);
  if (!canExport && !canValidateImport) redirect("/accounts");

  return (
    <ApplicationShell>
      <main
        className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
        id="main-content"
        tabIndex={-1}
      >
        <p className="text-sm font-medium text-[var(--accent)]">
          Data portability
        </p>
        <h1 className="mt-1 text-3xl font-semibold">
          Export and import validation
        </h1>
        <p className="mt-2 max-w-3xl text-[var(--muted)]">
          Download portable Account data or validate a file without changing the
          Account. Each operation rechecks its own exact capability.
        </p>
        <PortableDataTools
          accountId={accountId}
          canExport={canExport}
          canValidateImport={canValidateImport}
          maximumBytes={MAX_PORTABLE_BYTES}
        />
      </main>
    </ApplicationShell>
  );
}
