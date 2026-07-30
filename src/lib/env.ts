import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_ENV: z
    .enum(["local", "preview", "production"])
    .default("local"),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_OAUTH_PROVIDER: z.enum(["google", "github", "azure"]).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
type EnvironmentInput = Record<string, string | undefined>;

export function parseServerEnv(
  input: EnvironmentInput = process.env,
): ServerEnv {
  return serverEnvSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv();
}
