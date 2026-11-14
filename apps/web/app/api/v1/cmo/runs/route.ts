import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { startCmoRun } from "@/lib/cmo/jobs/start";

export const dynamic = "force-dynamic";
// Việc chạy trong `after()` sau khi trả lời: một lượt soạn bài/lập lịch thường 20–90 giây.
export const maxDuration = 300;

const body = z.object({
  kind: z.enum(["plan_week", "post_draft", "sales_scan"]),
  idea: z.string().trim().max(300).optional(),
});

/**
 * "Plan my week" and "Run now" of the X and Reddit agents. The daily cap and the credits are checked in
 * `enqueue_cmo_run`: without enough credits the founder gets its "needs credits" answer.
 */
export const POST = withApi({ body, rateLimit: { bucket: "cmo-runs", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const input: Record<string, unknown> = body.idea ? { idea: body.idea } : {};
  return startCmoRun(supabase, body.kind, input);
});
