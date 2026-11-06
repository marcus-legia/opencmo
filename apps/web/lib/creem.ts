/**
 * Creem, the payment provider: the API URL, its webhook signature and event envelope.
 *
 * Plain `fetch` and `node:crypto` instead of an SDK: the path money comes in stays readable.
 *
 * The signature is a hex HMAC-SHA256 of the raw body, keyed with the whole secret as UTF-8 (`whsec_` included), checked
 * against real deliveries. The body MUST be the raw one: parsing and stringifying again changes it. It has no timestamp,
 * so the route caps an event's age itself.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/api/errors";

/** The URL follows the key, so a test key can never reach production and a live key can never reach the sandbox. */
export function creemApiBase(apiKey: string): string {
  return apiKey.startsWith("creem_test_") ? "https://test-api.creem.io" : "https://api.creem.io";
}

/** A server call to Creem. The key stays on the server; a failure reaches the user as a retryable message, without details. */
export async function creemPost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = process.env.CREEM_API_KEY?.trim();
  if (!apiKey) throw new ApiError(503, "Payments are not set up on this server.");
  let response: Response;
  try {
    response = await fetch(`${creemApiBase(apiKey)}${path}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    console.error("[creem] could not reach", path);
    throw new ApiError(502, "Could not reach the payment provider. Please try again.");
  }
  if (!response.ok) {
    console.error("[creem] refused", path, response.status);
    throw new ApiError(502, "The payment provider refused this request. Please try again.");
  }
  return (await response.json()) as T;
}

export function verifySignature(body: string, signature: string | null, secret: string): { ok: true } | { ok: false; reason: string } {
  if (!signature) return { ok: false, reason: "missing creem-signature header" };
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(body).digest();
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

export type CreemEvent = { id: string; type: string; createdAt: Date; object: Record<string, unknown> };

/** The envelope, or null when any part of it is missing. `created_at` is epoch milliseconds. */
export function parseEvent(body: string): CreemEvent | null {
  let event: { id?: unknown; eventType?: unknown; created_at?: unknown; object?: unknown };
  try {
    event = JSON.parse(body);
  } catch {
    return null;
  }
  if (!event || typeof event !== "object") return null;
  const { id, eventType, created_at: createdAt, object } = event;
  if (typeof id !== "string" || !id || typeof eventType !== "string" || !eventType) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return null;
  return { id, type: eventType, createdAt: at, object: object as Record<string, unknown> };
}
