export type AuthorizationErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_SESSION"
  | "SESSION_EXPIRED"
  | "PROVIDER_FAILURE"
  | "USER_DISABLED"
  | "NO_ACTIVE_MEMBERSHIP"
  | "INSUFFICIENT_CAPABILITY"
  | "INVALID_SCOPE"
  | "ACCOUNT_UNAVAILABLE"
  | "RESOURCE_UNAVAILABLE"
  | "STALE_AUTHORITY"
  | "AUTHORIZATION_REQUIRED"
  | "CONFIGURATION_ERROR"
  | "AUDIT_FAILURE";

export class AuthorizationError extends Error {
  constructor(
    readonly code: AuthorizationErrorCode,
    message = "The requested operation is unavailable.",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function safeAuthorizationStatus(error: unknown): 401 | 403 | 500 {
  if (!(error instanceof AuthorizationError)) return 500;
  if (
    error.code === "AUTHENTICATION_REQUIRED" ||
    error.code === "INVALID_SESSION" ||
    error.code === "SESSION_EXPIRED"
  ) {
    return 401;
  }
  return error.code === "CONFIGURATION_ERROR" ||
    error.code === "PROVIDER_FAILURE" ||
    error.code === "AUDIT_FAILURE"
    ? 500
    : 403;
}

export function safeAuthorizationMessage(error: unknown): string {
  const status = safeAuthorizationStatus(error);
  if (status === 401) return "Authentication is required.";
  if (status === 403) return "The requested operation is unavailable.";
  return "Authentication is temporarily unavailable.";
}
