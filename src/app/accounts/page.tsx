import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  selectAccount,
  updateProductAnalyticsPreference,
} from "@/app/accounts/actions";
import { signOut } from "@/app/login/actions";
import { getProductAnalyticsService } from "@/server/app/product-analytics-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  let identity;
  try {
    identity = await authenticatePageSession();
  } catch (error) {
    if (error instanceof AuthorizationError) redirect("/login");
    throw error;
  }
  const accounts =
    await getAuthorizationService().listAvailableAccounts(identity);
  const selected = (await cookies()).get(selectedAccountCookie.name)?.value;
  const selectedAccount = accounts.find(({ id }) => id === selected);
  const analyticsPreference = selectedAccount
    ? await getProductAnalyticsService().preference(
        selectedAccount.id,
        await getAuthorizationService().authorize(
          identity,
          { kind: "ACCOUNT", accountId: selectedAccount.id },
          "account.view",
        ),
      )
    : null;

  return (
    <main className="mx-auto max-w-2xl p-8" id="main-content" tabIndex={-1}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Select an account</h1>
        <form action={signOut}>
          <button
            className="min-h-11 rounded-lg px-3 text-sm underline"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Selection is a navigation preference. Every protected operation rechecks
        current membership and scope.
      </p>
      {selected ? (
        <Link
          className="mt-4 inline-flex min-h-11 items-center rounded bg-slate-900 px-4 text-sm font-medium text-white"
          href="/games/setup"
        >
          Continue to game setup
        </Link>
      ) : null}
      {accounts.length === 0 ? (
        <p className="mt-6">No active account membership is available.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {accounts.map((account) => (
            <li
              className="rounded border border-slate-200 p-4"
              key={account.id}
            >
              <form action={selectAccount}>
                <input name="accountId" type="hidden" value={account.id} />
                <button
                  className="min-h-11 w-full rounded-lg text-left"
                  type="submit"
                >
                  <span className="font-medium">{account.displayName}</span>
                  <span className="ml-2 text-sm text-slate-500">
                    {selected === account.id ? "Selected" : account.slug}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {selectedAccount && analyticsPreference ? (
        <section
          aria-labelledby="analytics-preference-heading"
          className="mt-8 rounded border border-slate-200 p-4"
        >
          <h2
            className="text-lg font-semibold"
            id="analytics-preference-heading"
          >
            Privacy-safe product analytics
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Optional analytics measures coarse scoring success, baseball-rule
            rejections, and workflow failures. It never includes names, game or
            Account identifiers, raw scoring input, reports, tokens, or contact
            data. Consent expires after one year and can be withdrawn anytime.
          </p>
          <p className="mt-2 text-sm font-medium" aria-live="polite">
            Current choice: {analyticsPreference.effectiveOptIn ? "On" : "Off"}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={updateProductAnalyticsPreference}>
              <input
                name="accountId"
                type="hidden"
                value={selectedAccount.id}
              />
              <input name="status" type="hidden" value="OPTED_IN" />
              <button
                className="min-h-11 rounded bg-slate-900 px-4 text-sm font-medium text-white"
                type="submit"
              >
                Allow analytics
              </button>
            </form>
            <form action={updateProductAnalyticsPreference}>
              <input
                name="accountId"
                type="hidden"
                value={selectedAccount.id}
              />
              <input name="status" type="hidden" value="OPTED_OUT" />
              <button
                className="min-h-11 rounded border border-slate-400 px-4 text-sm font-medium"
                type="submit"
              >
                Turn off analytics
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </main>
  );
}
