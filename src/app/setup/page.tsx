import { redirect } from "next/navigation";

import {
  bootstrapAdministrator,
  completeSetup,
  initializeConfiguration,
  signInSetupLocal,
  signInSetupOAuth,
} from "@/app/setup/actions";
import {
  FeedbackState,
  PageShell,
  SectionHeader,
  Surface,
} from "@/components/ui/product-primitives";
import { getInstallationSetupService } from "@/server/app/installation-setup-service";
import { getLocalAuthenticationService } from "@/server/app/local-authentication-service";
import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { AuthorizationError } from "@/server/auth/errors";
import { authenticatePageSession } from "@/server/auth/next-session";
import { deploymentConfiguration } from "@/server/config/runtime-environment";
import { getAuthorizationService } from "@/server/auth/application";

export const dynamic = "force-dynamic";

const progress = [
  "Welcome",
  "Administrator",
  "Identity",
  "Verification",
  "Ready",
];

async function optionalIdentity() {
  try {
    return await authenticatePageSession();
  } catch (error) {
    if (error instanceof AuthorizationError) return null;
    throw error;
  }
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const service = getInstallationSetupService();
  const initial = await service.snapshot();
  if (initial.setup?.status === "READY") redirect("/");
  if (initial.setup?.status === "NOT_STARTED") await service.begin();

  const [snapshot, params, identity] = await Promise.all([
    service.snapshot(),
    searchParams,
    optionalIdentity(),
  ]);
  if (identity && snapshot.setup?.accountId) {
    try {
      await getAuthorizationService().authorize(
        identity,
        { kind: "ACCOUNT", accountId: snapshot.setup.accountId },
        "configuration.view",
      );
    } catch {
      redirect("/login?error=account_unavailable");
    }
  }
  let providers: ReadonlyArray<{ key: string; label: string }> = [];
  let localEnabled = false;
  try {
    providers = getOAuthAuthenticationService().providers();
  } catch {
    providers = [];
  }
  try {
    localEnabled = getLocalAuthenticationService().enabled();
  } catch {
    localEnabled = false;
  }
  const configured = snapshot.setup?.status === "CONFIGURATION_REQUIRED";
  const currentStep = !identity
    ? 0
    : snapshot.setup?.status === "ADMIN_CREATED"
      ? 2
      : configured
        ? 3
        : 1;
  const deployment = deploymentConfiguration();

  return (
    <PageShell className="max-w-5xl">
      <SectionHeader
        eyebrow="First launch"
        title="Set up Baseball Stat Track"
        description="Deployment is running. Complete the one-time application bootstrap before using the Admin Portal."
      />

      <ol
        className="mt-6 grid gap-2 sm:grid-cols-5"
        aria-label="Setup progress"
      >
        {progress.map((label, index) => (
          <li
            className={`rounded-lg border p-3 text-sm ${index <= currentStep ? "border-[var(--accent)] bg-white font-semibold" : "border-[var(--line)] text-[var(--muted)]"}`}
            key={label}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {params.error ? (
        <div className="mt-5">
          <FeedbackState tone="error">{params.error}</FeedbackState>
        </div>
      ) : null}
      {params.notice ? (
        <div className="mt-5">
          <FeedbackState tone="success">{params.notice}</FeedbackState>
        </div>
      ) : null}

      <Surface className="mt-6">
        <h2 className="text-xl font-semibold">Deployment status</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--muted)]">Application</dt>
            <dd className="font-semibold">Baseball Stat Track</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Version</dt>
            <dd className="font-semibold">{deployment.packageVersion}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Deployment</dt>
            <dd className="font-semibold">
              {snapshot.checks.database && snapshot.checks.migrations
                ? "Operational"
                : "Deployment configuration required"}
            </dd>
          </div>
        </dl>
      </Surface>

      {!identity ? (
        <Surface className="mt-6">
          <h2 className="text-xl font-semibold">
            Authenticate the first administrator
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Use the local account or an OAuth provider already configured by
            deployment. Provider credentials stay outside this wizard.
          </p>
          {localEnabled ? (
            <form
              action={signInSetupLocal}
              className="mt-5 grid max-w-md gap-3"
            >
              <label className="grid gap-1 text-sm font-medium">
                Username
                <input
                  className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                  name="username"
                  required
                  autoComplete="username"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Password
                <input
                  className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
              <button
                className="ui-action ui-action--primary min-h-11 w-fit"
                type="submit"
              >
                Sign in locally
              </button>
            </form>
          ) : null}
          <form action={signInSetupOAuth} className="mt-5 flex flex-wrap gap-3">
            {providers.map((provider) => (
              <button
                className="ui-action ui-action--secondary min-h-11"
                key={provider.key}
                name="provider"
                value={provider.key}
              >
                Continue with {provider.label}
              </button>
            ))}
          </form>
          {!providers.length && !localEnabled ? (
            <div className="mt-4">
              <FeedbackState tone="warning">
                Deployment configuration required: enable local authentication
                or configure an OAuth provider.
              </FeedbackState>
            </div>
          ) : null}
        </Surface>
      ) : snapshot.setup?.status === "BOOTSTRAP_IN_PROGRESS" ? (
        <Surface className="mt-6">
          <h2 className="text-xl font-semibold">
            Create the initial Account owner
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your authenticated AppUser will receive an active Account membership
            and Owner role through the normal authorization model.
          </p>
          <form
            action={bootstrapAdministrator}
            className="mt-5 grid max-w-xl gap-3"
          >
            <label className="grid gap-1 text-sm font-medium">
              Account name
              <input
                className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                name="accountName"
                required
                defaultValue={
                  deployment.localAccountName ?? "Baseball Operations"
                }
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Account slug
              <input
                className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                name="accountSlug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                defaultValue={
                  deployment.localAccountSlug ?? "baseball-operations"
                }
              />
            </label>
            <button
              className="ui-action ui-action--primary min-h-11 w-fit"
              type="submit"
            >
              Create administrator
            </button>
          </form>
        </Surface>
      ) : snapshot.setup?.status === "ADMIN_CREATED" &&
        snapshot.setup.accountId ? (
        <Surface className="mt-6">
          <h2 className="text-xl font-semibold">
            Establish application identity
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            These non-secret values create revision 1 in the existing Account
            configuration service.
          </p>
          <form
            action={initializeConfiguration}
            className="mt-5 grid max-w-xl gap-3"
          >
            <input
              type="hidden"
              name="accountId"
              value={snapshot.setup.accountId}
            />
            <label className="grid gap-1 text-sm font-medium">
              Installation name
              <input
                className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                name="installationName"
                required
                defaultValue="Baseball Stat Track"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Organization display name
              <input
                className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                name="organizationName"
                required
                defaultValue={
                  deployment.localAccountName ?? "Baseball Operations"
                }
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Timezone
                <input
                  className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                  name="timezone"
                  required
                  defaultValue="America/New_York"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Locale
                <input
                  className="min-h-11 rounded-lg border border-[var(--line)] px-3"
                  name="locale"
                  required
                  defaultValue="en-US"
                />
              </label>
            </div>
            <button
              className="ui-action ui-action--primary min-h-11 w-fit"
              type="submit"
            >
              Save initial configuration
            </button>
          </form>
        </Surface>
      ) : configured ? (
        <Surface className="mt-6">
          <h2 className="text-xl font-semibold">Readiness confirmation</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            This verifies deployment-owned provider configuration without
            displaying credentials or tokens.
          </p>
          <dl className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {Object.entries(snapshot.checks).map(([check, passed]) => (
              <div
                className="flex items-center justify-between py-3"
                key={check}
              >
                <dt className="capitalize">{check}</dt>
                <dd className={passed ? "text-emerald-700" : "text-amber-800"}>
                  {passed ? "Ready" : "Deployment configuration required"}
                </dd>
              </div>
            ))}
          </dl>
          {Object.values(snapshot.checks).every(Boolean) ? (
            <form action={completeSetup} className="mt-5">
              <button
                className="ui-action ui-action--primary min-h-11"
                type="submit"
              >
                Complete setup and open Admin Portal
              </button>
            </form>
          ) : (
            <div className="mt-5">
              <FeedbackState tone="warning">
                Resolve the deployment checks, then refresh this page. Setup
                progress is persisted.
              </FeedbackState>
            </div>
          )}
        </Surface>
      ) : null}
    </PageShell>
  );
}
