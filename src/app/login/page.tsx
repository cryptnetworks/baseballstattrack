import { signIn } from "@/app/login/actions";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-3 text-sm text-slate-600">
        Continue through the configured identity provider. Your provider session
        identifies you; current account membership controls access.
      </p>
      <form action={signIn} className="mt-6">
        <button
          className="rounded bg-slate-900 px-4 py-2 text-white"
          type="submit"
        >
          Continue to sign in
        </button>
      </form>
    </main>
  );
}
