import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { salesBanRisk } from "@/lib/cmo/sales/ban-risk";

export const dynamic = "force-dynamic";

const body = z
  .object({
    // 5.3: a rule that would get the founder's Reddit account banned is refused here first, then by SQL.
    text: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .superRefine((text, ctx) => {
        const risk = salesBanRisk(text);
        if (risk) ctx.addIssue({ code: z.ZodIssueCode.custom, message: risk });
      })
      .optional(),
    on: z.boolean().optional(),
  })
  .refine((b) => b.text !== undefined || b.on !== undefined, "Change the words, or turn the rule on or off.");

/** Edits a rule's words or turns it on or off (`cmo_edit_correction`, owner-checked); the history keeps the change. */
export const PATCH = withApi({ body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body, params }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id ?? "")) throw new ApiError(404, "Rule not found.");
  await rpcOrThrow(supabase, "cmo_edit_correction", { p_id: params.id, p_text: body.text ?? null, p_active: body.on ?? null });
  return { ok: true };
});
