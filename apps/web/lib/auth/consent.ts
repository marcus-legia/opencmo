/**
 * Who may approve an OAuth connection to OpenCMO (`/oauth/consent` and `api/v1/oauth/consent`).
 * One place, so the page never offers an Allow that the route would refuse.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Shown to a free account instead of Allow (security fixes plan, fix 5). */
export const PAID_PLAN_CONSENT = "Connecting apps to OpenCMO is part of the paid plans. Choose a plan on the Credits page, then connect again.";

/** Shown when the app would send the code to a host we don't support (fix 6). */
export const UNKNOWN_APP_CONSENT = "This app can't connect to OpenCMO.";

/** SQL `is_paid` is the single definition; any error counts as unpaid. */
export async function paidUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_paid", { p_user: userId });
  return !error && data === true;
}

const DEFAULT_REDIRECT_HOSTS = "claude.ai,claude.com,localhost,127.0.0.1";

/**
 * The host the authorization code goes to, if we support it. Dynamic client registration is open
 * (claude.ai registers itself), so any site can register a client called "Claude"; the redirect
 * host is the part a phishing client cannot fake. Exact hostnames, no subdomains.
 */
export function allowedRedirectHost(redirectUri: string, env: Record<string, string | undefined> = process.env): string | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  const host = url.hostname;
  // Loopback is how desktop and CLI clients (Claude Code) receive the code (RFC 8252): plain http to
  // this computer. Every other host must be https, so the code never crosses the network in clear.
  if (url.protocol !== (isLoopbackHost(host) ? "http:" : "https:")) return null;
  const allowed = (env.OPENCMO_OAUTH_REDIRECT_HOSTS ?? DEFAULT_REDIRECT_HOSTS)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(host.toLowerCase()) ? host : null;
}

function isLoopbackHost(host: string): boolean {
  return ["localhost", "127.0.0.1"].includes(host.toLowerCase());
}

/** The code goes to an app on the founder's own computer: the consent page says so, since any local program can listen there. */
export function isLoopbackRedirect(redirectUri: string): boolean {
  try {
    return isLoopbackHost(new URL(redirectUri).hostname);
  } catch {
    return false;
  }
}

/** Records the grant the MCP server checks on every request (`mcp_grants`). */
export async function recordGrant(supabase: SupabaseClient, clientId: string): Promise<boolean> {
  const { error } = await supabase.rpc("mcp_grant_record", { p_client_id: clientId });
  if (error) console.error("[oauth] could not record the grant", error.message);
  return !error;
}
