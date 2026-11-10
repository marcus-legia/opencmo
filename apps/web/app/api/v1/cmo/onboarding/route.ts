import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { runOnboarding } from "@/lib/cmo/onboard";

export const dynamic = "force-dynamic";
// Reading a few pages and one model call take 20–60 s; then the first week's plan and draft run in `after()`.
export const maxDuration = 300;

const body = z.object({ site: z.string().trim().min(3).max(300) });

// Each onboarding reads a website and runs the model. The first run is free (CMO review 3, 3.1): `start_cmo_run` lets
// an account without a plan onboard twice ever (once more for a typo) and answers the third with the 402
// `plan_required`, before any of that work. This limit stops a loop before the database is asked at all.
export const POST = withApi({ body, rateLimit: { bucket: "onboarding", limit: 20, windowSeconds: 3600 } }, async ({ supabase, user, body }) =>
  runOnboarding(supabase, user.id, body.site, Date.now()),
);
