import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApplicationShell } from "@/components/app/application-shell";
import { PortableDataTools } from "@/components/data/portable-data-tools";
import { PageShell, SectionHeader } from "@/components/ui/product-primitives";
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
      <PageShell id="main-content" tabIndex={-1}>
        <SectionHeader
          eyebrow="Data"
          title="Export and import validation"
          description="Download portable Account data or validate a file without changing the Account. Each operation rechecks its own exact capability."
        />
        <PortableDataTools
          accountId={accountId}
          canExport={canExport}
          canValidateImport={canValidateImport}
          maximumBytes={MAX_PORTABLE_BYTES}
        />
      </PageShell>
    </ApplicationShell>
  );
}
