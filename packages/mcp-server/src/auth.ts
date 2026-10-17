/**
 * Who is calling: `Authorization: Bearer …` → a user id and a Supabase client under that user's RLS.
 *
 * - `ocm_…` personal API keys (Settings → API keys), for Claude Code and Claude Desktop configs:
 *   `api_key_owner` (the one service-role call of the MCP path) → a 5-minute user JWT
 *   (`lib/mcp/auth.ts`, shared with the Vercel route).
 * - OAuth access tokens (`oauth.ts`), for claude.ai's connector UI.
 *
 * Every tool after that runs under RLS exactly as if the user clicked in the app.
 */

import { userForKey, userToken } from "@/lib/mcp/auth";

import { userClient } from "./client";
import type { SupabaseClient } from "./registry";
import { userForAccessToken } from "./oauth";

export type Caller = { userId: string; supabase: SupabaseClient; via: "api_key" | "oauth" };

const bearer = (authorization: string | null) => /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "")?.[1] ?? null;

/** null: no credentials, or credentials that do not name a user (missing, wrong, revoked, expired). */
export async function authenticate(authorization: string | null): Promise<Caller | null> {
  const token = bearer(authorization);
  if (!token) return null;
  if (token.startsWith("ocm_")) {
    const userId = await userForKey(`Bearer ${token}`);
    return userId ? { userId, supabase: userClient(userToken(userId)), via: "api_key" } : null;
  }
  const oauth = await userForAccessToken(token);
  return oauth ? { ...oauth, via: "oauth" } : null;
}
