import { createClient } from "@supabase/supabase-js";

import { state } from "./helpers";

/**
 * The v2 specs need founders past Setup: `/app` sends a founder with no documents to `/app/setup`. One product
 * document is enough; a second run finds it and inserts nothing.
 */
export async function ensureOnboarded(): Promise<void> {
  const { url, service, users } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  for (const user of [users.a, users.b]) {
    const { error } = await admin.from("marketing_documents").upsert(
      { user_id: user.id, kind: "product", version: 1, created_by: "user", body: { name: "OpenCMO", one_liner: "An AI CMO for solo founders." } },
      { onConflict: "user_id,kind,version", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not seed a document: ${error.message}`);
  }
}
