/**
 * OAuth 2.1 for claude.ai's connector UI (A8).
 *
 * Supabase Auth is the authorization server (its OAuth 2.1 server: authorization code + PKCE,
 * dynamic client registration, metadata at `<supabase>/.well-known/oauth-authorization-server/auth/v1`).
 * This server is only the protected resource:
 *
 * 1. A request without a token gets 401 + `WWW-Authenticate: Bearer resource_metadata=…`.
 * 2. The client reads `/.well-known/oauth-protected-resource`, finds Supabase Auth, registers
 *    itself and sends the user to sign in; the consent screen is the web app's `/oauth/consent`.
 * 3. The access token is a Supabase user JWT carrying the OAuth `client_id`. It is checked with
 *    Supabase Auth on every request (`getUser`), so a revoked grant stops working at once, and it is
 *    then used as is: the tools run under that user's RLS, like an API key's short-lived JWT.
 */

import { userClient } from "./client";
import type { SupabaseClient } from "./registry";

const supabaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  return url.replace(/\/+$/, "");
};

/** The issuer clients get their token from. */
export const authorizationServer = (): string => process.env.OPENCMO_OAUTH_ISSUER ?? `${supabaseUrl()}/auth/v1`;

/** This server's public origin: `OPENCMO_MCP_URL` on Modal, else what the request says. */
function origin(request: Request): string {
  const configured = process.env.OPENCMO_MCP_URL;
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** The resource clients ask a token for: the MCP endpoint itself. */
export const resourceUrl = (request: Request): string => `${origin(request)}/mcp`;

export const resourceMetadataUrl = (request: Request): string => `${origin(request)}/.well-known/oauth-protected-resource`;

/** RFC 9728 protected-resource metadata. */
export function protectedResourceMetadata(request: Request) {
  return {
    resource: resourceUrl(request),
    authorization_servers: [authorizationServer()],
    bearer_methods_supported: ["header"],
    resource_name: "OpenCMO",
    resource_documentation: `${process.env.OPENCMO_WEB_URL ?? "https://opencmo.io"}/settings/api-keys`,
  };
}

/** The JWT's claims, unverified: only read after Supabase Auth has accepted the token. */
function claims(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** An OAuth access token → its user, or null (not a JWT, expired, revoked, or a plain web session). */
export async function userForAccessToken(token: string): Promise<{ userId: string; supabase: SupabaseClient } | null> {
  if (token.split(".").length !== 3) return null;
  const supabase = userClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  // Only tokens issued to an OAuth client: a browser session token is for the web app, not for MCP.
  const body = claims(token);
  if (!body || typeof body.client_id !== "string" || !body.client_id) return null;
  return { userId: data.user.id, supabase };
}
