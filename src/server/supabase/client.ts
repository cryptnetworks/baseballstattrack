import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

export function createSupabaseBrowserBoundary() {
  const env = getServerEnv();

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase public URL and anon key are required before creating a client.",
    );
  }

  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
