import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  selectAccount,
  updateProductAnalyticsPreference,
} from "@/app/accounts/actions";
import { signOut } from "@/app/login/actions";
import { ApplicationShell } from "@/components/app/application-shell";
import { DiscordInstallationPanel } from "@/components/accounts/discord-installation-panel";
import {
  ActionLink,
  EmptyState,
  PageShell,
  SectionHeader,
  Surface,
} from "@/components/ui/product-primitives";
import { getProductAnalyticsService } from "@/server/app/product-analytics-service";
import { getAuthorizationService } from "@/server/auth/application";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { selectedAccountCookie } from "@/server/auth/request-security";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ discord?: string }>;
}) {
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
  const discordResult = (await searchParams).discord;
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
    <ApplicationShell>
      <PageShell className="max-w-3xl">
        <SectionHeader
          eyebrow="Workspace"
          title="Select an account"
          description="Account selection changes navigation context. Protected operations recheck current membership and scope on the server."
          actions={
            <form action={signOut}>
              <button
                className="ui-action ui-action--quiet min-h-11"
                type="submit"
              >
                Sign out
              </button>
            </form>
          }
        />
        <p className="mt-3 text-sm text-slate-600">
          Choose the account whose teams, seasons, games, and reports you want
          to work with.
        </p>
        {selected ? (
          <div className="mt-4">
            <ActionLink href="/games/setup" variant="primary">
              Continue to game setup
            </ActionLink>
          </div>
        ) : null}
        {accounts.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No active account membership"
              description="Ask an account administrator to add your identity before using protected workspaces."
            />
          </div>
        ) : (
          <Surface
            as="section"
            className="mt-6"
            labelledBy="account-list-heading"
          >
            <h2 className="text-lg font-semibold" id="account-list-heading">
              Available accounts
            </h2>
            <ul className="mt-4 space-y-3">
              {accounts.map((account) => (
                <li
                  className="rounded-lg border border-[var(--line)] p-2 transition hover:border-[var(--accent)]"
                  key={account.id}
                >
                  <form action={selectAccount}>
                    <input name="accountId" type="hidden" value={account.id} />
                    <button
                      className="min-h-11 w-full rounded-md px-2 text-left"
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
          </Surface>
        )}
        {selectedAccount && analyticsPreference ? (
          <section
            aria-labelledby="analytics-preference-heading"
            className="ui-surface mt-8"
          >
            <h2
              className="text-lg font-semibold"
              id="analytics-preference-heading"
            >
              Privacy-safe product analytics
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Optional analytics measures coarse scoring success, baseball-rule
              rejections, and workflow failures. It never includes names, game
              or Account identifiers, raw scoring input, reports, tokens, or
              contact data. Consent expires after one year and can be withdrawn
              anytime.
            </p>
            <p className="mt-2 text-sm font-medium" aria-live="polite">
              Current choice:{" "}
              {analyticsPreference.effectiveOptIn ? "On" : "Off"}
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
                  className="ui-action ui-action--primary min-h-11"
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
                  className="ui-action ui-action--secondary min-h-11"
                  type="submit"
                >
                  Turn off analytics
                </button>
              </form>
            </div>
          </section>
        ) : null}
        {selectedAccount ? (
          <DiscordInstallationPanel
            accountId={selectedAccount.id}
            result={discordResult}
          />
        ) : null}
      </PageShell>
    </ApplicationShell>
  );
}
