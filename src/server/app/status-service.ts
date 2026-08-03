import { getServerEnv } from "@/lib/env";
import { deploymentConfiguration } from "@/server/config/runtime-environment";

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
    version: deploymentConfiguration().packageVersion,
  };
}
