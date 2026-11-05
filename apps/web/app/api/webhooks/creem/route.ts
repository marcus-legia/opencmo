import { NextResponse, type NextRequest } from "next/server";

import { parseEvent, verifySignature } from "@/lib/creem";
import { createAdminClient } from "@/lib/supabase/admin";

/** 64 KB. Real Creem events weigh about 2.5 KB. */
const MAX_WEBHOOK_BYTES = 64 * 1024;

/**
 * The signature has no timestamp, so a captured body could be replayed once its receipt is cleaned up after 90 days.
 * Creem stops retrying after 24 hours, so 30 days refuses only replays and very late manual resends.
 */
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Reconciling by hand needs to know who, but the log must not leak the buyer's email. */
function maskEmail(object: Record<string, unknown>): string {
  const raw = (object.customer as { email?: unknown } | null)?.email;
  if (typeof raw !== "string") return "no-email";
  const at = raw.lastIndexOf("@");
  return at < 0 ? "no-email" : `***${raw.slice(at)}`;
}

/** Verifies the raw body first. Every billing write goes through one atomic RPC, which reads the catalogue itself. */
export async function POST(request: NextRequest) {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[creem] webhook is not configured");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 500 });
  }
  // This route does not go through `withApi`, so it has no body cap unless it sets one, and it is open to anyone.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  const body = await request.text();
  // `content-length` is absent on chunked requests; measure the real body, in bytes.
  if (Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  const check = verifySignature(body, request.headers.get("creem-signature"), secret);
  if (!check.ok) {
    console.warn("[creem] webhook refused:", check.reason);
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const event = parseEvent(body);
  if (!event) return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  if (Date.now() - event.createdAt.getTime() > MAX_EVENT_AGE_MS) {
    console.warn("[creem] event too old, refused:", event.id, event.type);
    return NextResponse.json({ error: "Webhook event is too old." }, { status: 400 });
  }
  try {
    const { data: result, error } = await createAdminClient().rpc("process_creem_event", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_at: event.createdAt.toISOString(),
      p_object: event.object,
    });
    if (error) {
      // A 5xx is what makes Creem retry, which is what an unknown product or an unseen payment needs. The database's
      // detail can hold the payload, so only the code and our own message are logged.
      console.error("[creem] billing transaction failed", error.code, error.code === "22023" ? error.message : "", event.type, maskEmail(event.object));
      return NextResponse.json({ error: "Unable to process billing event." }, { status: 500 });
    }
    if (result && typeof result === "object" && typeof result.skipped === "string") {
      console.warn("[creem] skipped", event.type, "-", result.skipped, maskEmail(event.object));
    }
    return NextResponse.json(result);
  } catch {
    console.error("[creem] could not reach the billing service");
    return NextResponse.json({ error: "Unable to process billing event." }, { status: 500 });
  }
}
