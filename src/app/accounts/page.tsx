import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { selectAccount } from "@/app/accounts/actions";
import { signOut } from "@/app/login/actions";
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
    </main>
  );
}
