import { deploymentConfiguration } from "@/server/config/runtime-environment";

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: deploymentConfiguration().nodeEnvironment === "production",
    path: "/",
  };
}
