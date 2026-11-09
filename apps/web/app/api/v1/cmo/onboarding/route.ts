import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { runOnboarding } from "@/lib/cmo/onboard";
import { hasPlanOrCredits } from "@/lib/paid-first";

export const dynamic = "force-dynamic";
// Reading a few pages and one model call take 20–60 s; then the first week's plan and draft run in `after()`.
export const maxDuration = 300;

const body = z.object({ site: z.string().trim().min(3).max(300) });

// Each onboarding reads a website and runs the model; SQL allows 5 a day, this stops a loop before any of that work.
// Paid first (owner, 2026-11-08): the model work runs only for an account with a plan or credits. A founder back from
// Creem can get here before its webhook, so the check waits a few seconds before refusing.
async function paidOrWait(supabase: Parameters<typeof hasPlanOrCredits>[0], userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasPlanOrCredits(supabase, userId)) return true;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return false;
}

export const POST = withApi({ body, rateLimit: { bucket: "onboarding", limit: 20, windowSeconds: 3600 } }, async ({ supabase, user, body }) => {
  // The function's clock starts here, before the paid check's wait: `after()` work is timed from this moment.
  const started = Date.now();
  if (!(await paidOrWait(supabase, user.id))) {
    throw new ApiError(402, "We have not received a payment yet. If you just paid, try again in a minute; otherwise pick a plan first.");
  }
  return runOnboarding(supabase, user.id, body.site, started);
});
