import { AuthorizationError } from "@/server/auth/errors";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOrigin(request: Request): void {
  if (safeMethods.has(request.method.toUpperCase())) return;
  requireSameOriginValues(
    request.headers.get("origin"),
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
}

export function requireSameOriginValues(
  origin: string | null,
  host: string | null,
): void {
  if (!origin || !host) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
  if (originHost !== host) {
    throw new AuthorizationError("AUTHORIZATION_REQUIRED");
  }
}

export const selectedAccountCookie = {
  name: "bst_selected_account",
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  },
};
