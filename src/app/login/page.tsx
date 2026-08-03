import { signIn } from "@/app/login/actions";
import { getOAuthAuthenticationService } from "@/server/app/oauth-authentication-service";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let providers: ReadonlyArray<{ key: string; label: string }> = [];
  try {
    providers = getOAuthAuthenticationService().providers();
  } catch {
    providers = [];
  }
  return (
    <main className="mx-auto max-w-xl p-8" id="main-content" tabIndex={-1}>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-3 text-sm text-slate-600">
        Continue through the configured identity provider. Your provider session
        identifies you; current account membership controls access.
      </p>
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
        {!providers.length ? (
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
