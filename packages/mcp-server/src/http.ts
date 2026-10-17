/**
 * The HTTP face of the MCP server, as a fetch handler (`Request` → `Response`), so the same code runs
 * under Node's http server on Modal (`main.ts`) and in the checks without a socket.
 *
 *   POST /mcp                                   MCP Streamable HTTP, stateless, JSON responses
 *   GET  /.well-known/oauth-protected-resource  RFC 9728 metadata: where to get a token (A8)
 *   GET  /healthz                               Modal's readiness probe and uptime checks
 *
 * Every POST is authenticated and rate limited per JSON-RPC message (600 an hour per user, the
 * same `mcp` bucket as the Vercel route), so a batch cannot slip past the limit.
 */

import { authenticate, type Caller } from "./auth";
import { callModal, spawnModal } from "./modal";
import { protectedResourceMetadata, resourceMetadataUrl } from "./oauth";
import type { McpToolContext } from "./registry";
import { handleMcp } from "./server";

/** Scene code is at most 32,000 characters; a full video plan a few KB. */
export const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 20;

const CORS = {
  // Bearer tokens, never cookies: any origin may call, as with any public API (MCP Inspector runs in a browser).
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });
}

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);

function unauthorized(request: Request, message: string): Response {
  return rpcError(401, -32001, message, {
    // Where a client (claude.ai) learns how to get a token; an API-key client just shows the message.
    "www-authenticate": `Bearer realm="opencmo", resource_metadata="${resourceMetadataUrl(request)}"`,
  });
}

async function readBody(request: Request): Promise<{ body: unknown } | { error: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { error: rpcError(413, -32600, "This request is too large.") };
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    // Stop reading at the cap: a missing or false content-length must not pull the whole body into memory.
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: rpcError(413, -32600, "This request is too large.") };
    }
    chunks.push(value);
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { error: rpcError(400, -32700, "Parse error.") };
  }
}

export function contextFor(caller: Caller): McpToolContext {
  return { supabase: caller.supabase, userId: caller.userId, callModal, spawnModal };
}

/** Counts every JSON-RPC message of the body against the user's hourly limit. */
async function allowed(caller: Caller, messages: number): Promise<boolean | null> {
  for (let index = 0; index < messages; index++) {
    const { data, error } = await caller.supabase.rpc("rate_limit_hit", { p_bucket: "mcp", p_limit: 600, p_window_seconds: 3600 });
    if (error) {
      console.error("[mcp] rate limit failed", error);
      return null;
    }
    if (data === false) return false;
  }
  return true;
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (path === "/healthz") return json({ ok: true });
  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    if (request.method !== "GET") return json({ error: "Use GET." }, 405, { allow: "GET" });
    return json(protectedResourceMetadata(request));
  }
  if (path !== "/mcp" && path !== "/") return json({ error: "Not found." }, 404);
  // Stateless server: no server-to-client stream (GET) and no session to end (DELETE).
  if (request.method !== "POST") return json({ error: "This MCP server takes POST requests only." }, 405, { allow: "POST" });

  let caller: Caller | null;
  try {
    caller = await authenticate(request.headers.get("authorization"));
  } catch (err) {
    console.error("[mcp] auth failed", err);
    return rpcError(503, -32603, "Could not check these credentials. Please try again.");
  }
  if (!caller) return unauthorized(request, "Sign in to OpenCMO: connect this server, or send an API key (Authorization: Bearer ocm_…).");

  const read = await readBody(request);
  if ("error" in read) return read.error;
  const count = Array.isArray(read.body) ? read.body.length : 1;
  if (count < 1 || count > MAX_MESSAGES) return rpcError(400, -32600, `Send 1 to ${MAX_MESSAGES} messages per request.`);

  const ok = await allowed(caller, count);
  if (ok === null) return rpcError(503, -32603, "Could not start this request. Please try again.");
  if (!ok) return rpcError(429, -32000, "Too many requests from this account. Try again in an hour.");

  const response = await handleMcp(request, contextFor(caller), read.body);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
