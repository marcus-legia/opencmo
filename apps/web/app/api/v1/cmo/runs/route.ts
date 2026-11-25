import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { startCmoRun } from "@/lib/cmo/jobs/start";

export const dynamic = "force-dynamic";
// Việc chạy trong `after()` sau khi trả lời: một lượt soạn bài/lập lịch thường 20–90 giây.
export const maxDuration = 300;

const body = z.object({
  // Free scan A5: "Write the replies" on /app/sales, after paying (input `{}`; SQL refuses it for an unpaid account).
  kind: z.enum(["plan_week", "post_draft", "sales_scan", "sales_reply_drafts", "compose_check"]),
  idea: z.string().trim().max(300).optional(),
  // The Composer's Check (2026-11-25): the post the founder wrote and where it goes. Only for compose_check.
  input: z
    .object({
      platform: z.enum(["reddit", "x", "threads", "linkedin"]),
      subreddit: z.string().trim().max(40).optional(),
      title: z.string().max(300).optional(),
      body: z.string().trim().min(1).max(10000),
    })
    .optional(),
});

/**
 * "Plan my week" and "Run now" of the X and Reddit agents. The daily cap and the credits are checked in
 * `enqueue_cmo_run`: without enough credits the founder gets its "needs credits" answer.
 */
export const POST = withApi({ body, rateLimit: { bucket: "cmo-runs", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  if ((body.kind === "compose_check") !== Boolean(body.input)) throw new ApiError(400, body.input ? "Only a post check takes a post." : "Write the post first, then check it.");
  const input: Record<string, unknown> = body.kind === "compose_check" ? { ...body.input } : body.idea ? { idea: body.idea } : {};
  return startCmoRun(supabase, body.kind, input);
});
