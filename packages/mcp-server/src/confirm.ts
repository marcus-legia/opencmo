/**
 * Signed codes the client hands back: the price → confirm step, and the proof that scene code was
 * previewed. MCP is stateless, so what the server promised travels with the client, signed.
 *
 * A code binds the user, a purpose (the tool name, or "preview"), an expiry and a payload. The
 * payload is deflated: a quoted video holds every shot's spec, and the model copies the code back.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const CONFIRM_SECONDS = 600;
/** A preview stays valid for the request it was made for: an hour covers a long fix loop. */
export const PREVIEW_SECONDS = 3600;

export class ConfirmError extends Error {}

function key(): Buffer {
  const secret = process.env.SUPABASE_JWT_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing the signing key for MCP confirm codes (SUPABASE_JWT_SECRET).");
  // Its own label: a code signed for another purpose of the same secret never verifies here.
  return createHmac("sha256", "opencmo-mcp-confirm-v2").update(secret).digest();
}

type Body = { u: string; p: string; e: number; d: unknown };

export function sign(userId: string, purpose: string, payload: unknown, seconds = CONFIRM_SECONDS, now = Date.now()): string {
  const body: Body = { u: userId, p: purpose, e: Math.floor(now / 1000) + seconds, d: payload };
  const packed = deflateRawSync(Buffer.from(JSON.stringify(body), "utf8")).toString("base64url");
  return `${packed}.${createHmac("sha256", key()).update(packed).digest("base64url")}`;
}

export function read(token: string, userId: string, purpose: string, now = Date.now()): unknown {
  const [packed, signature, extra] = token.trim().split(".");
  const invalid = new ConfirmError("That confirm code is not valid. Ask for the price again.");
  if (!packed || !signature || extra !== undefined) throw invalid;
  const expected = createHmac("sha256", key()).update(packed).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid;
  let body: Body;
  try {
    body = JSON.parse(inflateRawSync(Buffer.from(packed, "base64url"), { maxOutputLength: 4 * 1024 * 1024 }).toString("utf8")) as Body;
  } catch {
    throw invalid;
  }
  if (body.u !== userId || body.p !== purpose) throw new ConfirmError("That confirm code belongs to another request. Ask for the price again.");
  if (body.e < Math.floor(now / 1000)) throw new ConfirmError("That price has expired. Ask for the price again.");
  return body.d;
}

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
