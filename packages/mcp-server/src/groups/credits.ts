/**
 * Credits: the founder's balance and plan, so a client can check before a priced tool.
 * Bodies: `apps/web/lib/mcp/credits.ts`.
 */

import { z } from "zod";

import { balance, BILLING_URL } from "@/lib/mcp/credits";

import { errorResult, registerGroup } from "../registry";

registerGroup({
  tools: [
    {
      name: "get_credits",
      title: "Get credits",
      description: "The founder's credit balance and plan. Media (images, video, voice, renders, exports past the plan) costs credits; check before a priced tool when the balance may be short.",
      inputSchema: z.object({}),
      outputSchema: z.object({ message: z.string(), credits: z.number(), plan: z.string(), billing_url: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(_input, { supabase, userId }) {
        const account = await balance(supabase, userId);
        if (!account) return errorResult("Could not read the credit balance. Try again in a minute.");
        const message = `${account.credits} credits (${account.plan} plan). Top up: ${BILLING_URL}`;
        return { content: [{ type: "text", text: message }], structuredContent: { message, ...account, billing_url: BILLING_URL } };
      },
    },
  ],
});
