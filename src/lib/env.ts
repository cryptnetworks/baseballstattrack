import { z } from "zod";

import {
  deploymentConfiguration,
  runtimeSecretConfiguration,
} from "@/server/config/runtime-environment";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_ENV: z
    .enum(["local", "preview", "production"])
    .default("local"),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
type EnvironmentInput = Record<string, string | undefined>;

export function parseServerEnv(input: EnvironmentInput): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  const deployment = deploymentConfiguration();
  const secrets = runtimeSecretConfiguration();
  return parseServerEnv({
    NODE_ENV: deployment.nodeEnvironment,
    NEXT_PUBLIC_APP_ENV: deployment.appEnvironment,
    NEXT_PUBLIC_SITE_URL: deployment.siteUrl,
    DATABASE_URL: secrets.databaseUrl,
    DIRECT_URL: secrets.directDatabaseUrl,
  });
}
