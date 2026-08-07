import { signIn, signInLocal } from "@/app/login/actions";
import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";
import { getLocalAuthenticationService } from "@/server/app/local-authentication-service";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let providers: ReadonlyArray<{ key: string; label: string }> = [];
  try {
    providers = getOAuthAuthenticationService().providers();
  } catch {
    providers = [];
  }
  let localEnabled = false;
  try {
    localEnabled = getLocalAuthenticationService().enabled();
  } catch {
    localEnabled = false;
  }
  const error = (await searchParams).error;
  return (
    <main className="mx-auto max-w-xl p-8" id="main-content" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-3 text-sm text-slate-600">
        Sign in with a configured local account or identity provider. Your
        account membership controls access.
      </p>
      {error === "local_credentials" ? (
        <p
          className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
          role="alert"
        >
          Invalid username or password.
        </p>
      ) : null}
      {localEnabled ? (
        <form action={signInLocal} className="mt-6 grid max-w-sm gap-3">
          <label className="grid gap-1 text-sm">
            Username
            <input
              className="rounded border p-2"
              name="username"
              required
              autoComplete="username"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Password
            <input
              className="rounded border p-2"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button
            className="min-h-11 rounded bg-blue-700 px-4 py-2 text-white"
            type="submit"
          >
            Sign in locally
          </button>
        </form>
      ) : null}
      <form action={signIn} className="mt-6 flex flex-wrap gap-3">
        {providers.map((provider) => (
          <button
            className="min-h-11 rounded bg-slate-900 px-4 py-2 text-white"
            key={provider.key}
            name="provider"
            type="submit"
            value={provider.key}
          >
            Continue with {provider.label}
          </button>
        ))}
        {!providers.length && !localEnabled ? (
          <p
            className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert"
          >
            Authentication is temporarily unavailable.
          </p>
        ) : null}
      </form>
    </main>
  );
}
