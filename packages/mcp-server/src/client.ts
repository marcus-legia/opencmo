import { createClient } from "@supabase/supabase-js";

import type { SupabaseClient } from "./registry";

/**
 * A client under `token`'s RLS. App code written for a cookie session calls `auth.getUser()` with no
 * argument (the export tool reads the user's plan); with no session stored that would fail, so it
 * asks Supabase Auth about this request's own token instead.
 */
export function userClient(token: string): SupabaseClient {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = (jwt?: string) => getUser(jwt ?? token);
  return client as unknown as SupabaseClient;
}
