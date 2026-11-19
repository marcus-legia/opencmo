import { z } from "zod";

import { apiErrorFromPostgrest } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { runOnboarding } from "@/lib/cmo/onboard";
import { buyerChips, type OnboardingStatus, type RunState } from "@/lib/cmo/onboard-status";

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

type RunRow = { id: string; kind: string; status: RunState; error: string | null; steps: unknown; created_at: string };

const stepsOf = (value: unknown): NonNullable<OnboardingStatus["run"]>["steps"] =>
  Array.isArray(value)
    ? value.flatMap((step) => {
        const { id, status } = (step ?? {}) as { id?: unknown; status?: unknown };
        return typeof id === "string" && (status === "running" || status === "done" || status === "failed") ? [{ id, status }] : [];
      })
    : [];

/**
 * What Setup polls every 2 s while onboarding runs (CMO review 3, 3.2): the latest onboarding run with its steps, then
 * the scan, plan and draft runs started after it, and the answers already given. Read under RLS.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  const [{ data: onboard, error }, { data: profile }, { data: product }] = await Promise.all([
    supabase.from("cmo_runs").select("id, kind, status, error, steps, created_at").eq("kind", "onboard").order("created_at", { ascending: false }).limit(1).maybeSingle<RunRow>(),
    supabase.from("profiles").select("x_handle, post_platforms, heard_from, sells_to").eq("id", user.id).maybeSingle<{ x_handle: string | null; post_platforms: string[] | null; heard_from: string | null; sells_to: string | null }>(),
    supabase.from("marketing_documents_latest").select("body").eq("kind", "product").maybeSingle<{ body: { x_handle?: unknown; audience?: unknown } }>(),
  ]);
  if (error) throw apiErrorFromPostgrest(error);
  let plan: RunState | null = null;
  let draft: RunState | null = null;
  let scan: RunState | null = null;
  let scanCards: number | null = null;
  if (onboard) {
    const { data: after } = await supabase
      .from("cmo_runs")
      .select("kind, status, output, created_at")
      .in("kind", ["plan_week", "post_draft", "sales_scan"])
      .gte("created_at", onboard.created_at)
      .order("created_at", { ascending: true })
      .limit(10);
    const rows = (after ?? []) as { kind: string; status: RunState; output: { cards?: unknown } | null }[];
    plan = rows.find((row) => row.kind === "plan_week")?.status ?? null;
    draft = rows.find((row) => row.kind === "post_draft")?.status ?? null;
    // The free scan onboarding queued (free-scan plan, A4): Setup ends on Sales when it runs or found people.
    const first = rows.find((row) => row.kind === "sales_scan");
    scan = first?.status ?? null;
    scanCards = typeof first?.output?.cards === "number" ? first.output.cards : null;
  }
  const handle = typeof product?.body.x_handle === "string" ? product.body.x_handle.replace(/^@/, "").trim() : "";
  const status: OnboardingStatus = {
    run: onboard
      ? { id: onboard.id, status: onboard.status === "queued" ? "running" : onboard.status, error: onboard.error, steps: stepsOf(onboard.steps), createdAt: onboard.created_at }
      : null,
    scan,
    scanCards,
    plan,
    draft,
    answers: { xHandle: profile?.x_handle ?? null, platforms: profile?.post_platforms ?? null, heardFrom: profile?.heard_from ?? null, sellsTo: profile?.sells_to ?? null },
    suggestedHandle: /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null,
    suggestedBuyers: typeof product?.body.audience === "string" ? buyerChips(product.body.audience) : [],
  };
  return status;
});
