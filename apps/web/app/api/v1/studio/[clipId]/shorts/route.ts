import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { jsonResponse, withApi } from "@/lib/api/handler";
import { studio } from "@/lib/departments/studio/adapter";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * "Cut shorts" (P2 F8): orders a `cut_shorts` work order the brain's runner cuts; 409 unless the edit is
 * finished at its current document. Shorts spend no generation credits, so the order has no price card.
 */
export const POST = withApi(
  { body: z.object({}).strict(), rateLimit: { bucket: "jobs", limit: 10, windowSeconds: 3600 } },
  async ({ supabase, user, params }) => {
    if (!UUID.test(params.clipId ?? "")) throw new ApiError(404, "Edit not found.");
    const ordered = await studio({ supabase, userId: user.id, caller: "ui" }).cutShorts(params.clipId!);
    if (ordered.kind === "refused") throw new ApiError(409, ordered.message);
    if (ordered.kind !== "ordered") throw new Error("The founder's Cut shorts must only order the cut.");
    return jsonResponse({ orderId: ordered.orderId }, 202);
  },
);
