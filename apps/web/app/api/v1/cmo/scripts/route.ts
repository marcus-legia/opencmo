import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const DAYS = 30;

export type ApprovedScript = { id: string; title: string; beats: { seconds: number; shot: string }[] };

/**
 * The scripts the founder approved and still has to film, for Studio's "Scripts to film". Same choice as Writer's
 * screen: of a script's cards the live one wins, else the decision; approved or edited means the founder records it.
 * Read under the founder's RLS.
 */
export const GET = withApi({}, async ({ supabase }) => {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: cards, error } = await supabase
    .from("approvals")
    .select("ref_id, status")
    .eq("ref_kind", "work_order")
    .eq("kind", "script")
    .gte("created_at", since)
    .limit(80);
  if (error) throw error;
  const rank = (status: string) => (status === "waiting" || status === "held" ? 2 : status === "approved" || status === "edited" ? 1 : 0);
  const best = new Map<string, string>();
  for (const c of (cards ?? []) as { ref_id: string; status: string }[]) {
    const seen = best.get(c.ref_id);
    if (seen === undefined || rank(c.status) > rank(seen)) best.set(c.ref_id, c.status);
  }
  const ids = [...best].filter(([, status]) => status === "approved" || status === "edited").map(([id]) => id);
  if (ids.length === 0) return { scripts: [] as ApprovedScript[] };
  const { data: orders, error: ordersError } = await supabase.from("work_orders").select("id, brief, created_at").in("id", ids).order("created_at", { ascending: false });
  if (ordersError) throw ordersError;
  const scripts = ((orders ?? []) as { id: string; brief: { objective?: unknown; storyboard?: unknown } | null }[])
    .filter((o) => Array.isArray(o.brief?.storyboard) && o.brief.storyboard.length > 0)
    .map((o) => ({
      id: o.id,
      title: (typeof o.brief?.objective === "string" && o.brief.objective ? o.brief.objective : "This week's video").slice(0, 300),
      // Only the shape of each beat (its length and how it is filmed), for the beat bar; the words stay on the prompter.
      beats: (o.brief!.storyboard as unknown[]).slice(0, 8).map((b) => {
        const beat = (b ?? {}) as { seconds?: unknown; shot?: unknown };
        return { seconds: typeof beat.seconds === "number" ? beat.seconds : 0, shot: typeof beat.shot === "string" ? beat.shot : "" };
      }),
    }));
  return { scripts };
});
