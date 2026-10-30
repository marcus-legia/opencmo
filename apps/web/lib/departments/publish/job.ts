/**
 * The `publish_post` CMO job (P4 B3): A2's sweep queues one per due slot with `{slot_id, order_id}`. Each run reads
 * the slot again through A2's RPCs and takes the next step of `runPublishPost`; an upload still running defers the
 * run instead of holding it open.
 *
 * Every RPC names the run's user and order: SQL checks the order is the one its claim made for that slot, so a run
 * can never post someone else's slot (`publish_slot_guard`).
 */

import { runPublishPost, type ExportFile, type FiredSlot, type MediaUpload, type PublishPostDeps, type PublishStatusUpdate } from "@/lib/cmo/jobs/publish-post";
import { Deferred, type JobContext, type JobOutput } from "@/lib/cmo/jobs/runner";

import type { PublishAdapter } from "./types";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An upload is checked again this often; Zernio's presigned URL lasts an hour. */
const UPLOAD_POLL_SECONDS = 30;

type SlotRead = Omit<FiredSlot, "status"> & { status: string; export: ExportFile | null; media: MediaUpload };

/** `PublishPostDeps` over A2's service-role RPCs. */
export function publishDeps(rpc: Rpc, adapter: PublishAdapter, userId: string, orderId: string): PublishPostDeps {
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await rpc(name, { ...args, p_user: userId, p_order: orderId });
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  let last: SlotRead | null = null;
  const read = async (slotId: string) => (last = await call<SlotRead>("publish_slot_read", { p_slot: slotId }));
  return {
    adapter,
    now: () => new Date(),
    slot: async (slotId) => {
      let s = await read(slotId);
      // The sweep leaves it `due`; starting re-checks window, pause and approval, then marks it `publishing`.
      if (s?.status === "due") {
        await call("publish_slot_start", { p_slot: slotId });
        s = await read(slotId);
      }
      return s;
    },
    exportFor: async () => last?.export ?? null,
    media: async (slotId) => (last?.id === slotId ? last.media : (await read(slotId)).media),
    startMedia: async (slotId, file, presigned) =>
      call<string>("publish_media_queue", { p_slot: slotId, p_object: file.object, p_upload_url: presigned.uploadUrl, p_public_url: presigned.publicUrl }),
    status: async (slotId, update: PublishStatusUpdate) => {
      const { error } = await rpc("publish_status", {
        p_slot: slotId,
        p_status: update.status,
        p_external_id: "externalId" in update ? update.externalId : null,
        p_url: update.status === "published" ? update.url : null,
        p_error: update.status === "failed" ? update.error : null,
      });
      if (error) throw new Error(`publish_status: ${error.message}`);
    },
  };
}

export async function publishPost(ctx: JobContext): Promise<JobOutput> {
  const slotId = ctx.run.input.slot_id;
  const orderId = ctx.run.input.order_id;
  if (typeof slotId !== "string" || !UUID.test(slotId) || typeof orderId !== "string" || !UUID.test(orderId)) {
    throw new Error("This post order has no slot.");
  }
  // Loaded here, not at the top: the runner's checks import every job without a database or a posting service.
  const [{ createAdminClient }, { publishAdapter }] = await Promise.all([import("@/lib/supabase/admin"), import("./adapter")]);
  const admin = createAdminClient();
  const deps = publishDeps((name, args) => admin.rpc(name, args), publishAdapter(), ctx.run.user_id, orderId);
  const outcome = await ctx.step("publish", "Posting at the approved time", () => runPublishPost(deps, slotId), (o) =>
    o.kind === "done" ? `Post ${o.status}` : o.kind === "waiting" ? o.text : `Skipped: ${o.reason}`,
  );
  if (outcome.kind === "waiting") throw new Deferred(UPLOAD_POLL_SECONDS);
  return { slot_id: slotId, ...outcome };
}
