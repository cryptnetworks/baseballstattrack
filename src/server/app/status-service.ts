import { getServerEnv } from "@/lib/env";

export type ApplicationStatus = {
  status: "ok";
  environment: "local" | "preview" | "production";
  eventSource: "game-events";
  version: string;
};

export function getApplicationStatus(): ApplicationStatus {
  const env = getServerEnv();

  return {
    status: "ok",
    environment: env.NEXT_PUBLIC_APP_ENV,
    eventSource: "game-events",
    version: process.env.npm_package_version ?? "0.1.0",
  };
}
