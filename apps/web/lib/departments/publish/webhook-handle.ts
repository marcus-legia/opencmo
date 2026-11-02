/**
 * Zernio's webhook, end to end but without Next or a live database (P4 B5): signature → event → receipt → A2's
 * status RPCs. The route (`app/api/webhooks/zernio/route.ts`) gives it the service-role client; the checks give it a
 * fake (`webhook.check.ts`).
 *
 * A receipt is claimed before the event is applied, so a replay is refused even while the first delivery is still
 * running. If applying fails, the receipt is given back, so Zernio's retry of the same event is not lost.
 */

import { WebhookPayloadError, parseZernioEvent, verifyZernioSignature, type ZernioUpdate } from "./webhook";

/** The few calls the webhook makes, as supabase-js answers them. */
export type WebhookDb = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  releaseReceipt(eventId: string): Promise<void>;
};

export type WebhookAnswer = { status: number; body: Record<string, unknown> };

async function apply(db: WebhookDb, update: Exclude<ZernioUpdate, { kind: "ignored" }>): Promise<{ error: { message: string; code?: string } | null }> {
  if (update.kind === "account") {
    return db.rpc("social_account_mark", { p_zernio_account_id: update.zernioAccountId, p_status: update.status });
  }
  return db.rpc("publish_status", {
    p_slot: update.slotId,
    p_status: update.status,
    p_external_id: update.externalId,
    p_url: update.url,
    p_error: update.status === "failed" ? { code: "refused", message: update.error ?? "The platform refused the post.", retryable: true } : null,
    p_zernio_account_id: update.zernioAccountId,
  });
}

export async function handleZernioWebhook(rawBody: string, signature: string | null, secret: string, db: WebhookDb): Promise<WebhookAnswer> {
  if (!verifyZernioSignature(rawBody, signature, secret)) return { status: 401, body: { error: "Invalid signature." } };
  let update: ZernioUpdate;
  try {
    update = parseZernioEvent(rawBody);
  } catch (error) {
    if (error instanceof WebhookPayloadError) return { status: 400, body: { error: error.message } };
    throw error;
  }
  const claim = await db.rpc("zernio_receipt_claim", { p_event_id: update.eventId });
  if (claim.error) return { status: 500, body: { error: "Could not record the event." } };
  if (claim.data !== true) return { status: 200, body: { ok: true, replay: true } };
  if (update.kind === "ignored") return { status: 200, body: { ok: true, ignored: update.event } };

  const { error } = await apply(db, update);
  if (!error) return { status: 200, body: { ok: true } };
  // Not ours to fix by retrying: a slot we no longer have, or an account that is not the slot's. Acknowledged.
  if (error.code === "P0002" || error.code === "P0001") return { status: 200, body: { ok: true, refused: error.message } };
  await db.releaseReceipt(update.eventId);
  return { status: 500, body: { error: "Could not apply the event." } };
}
