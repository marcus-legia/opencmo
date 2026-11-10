import { notFound, withApi } from "@/lib/api/handler";
import { DEPARTMENTS, type Department } from "@/lib/screens/common";
import { UI_V2 } from "@/lib/screens/flag";

export const dynamic = "force-dynamic";

const LIMIT = 100;
const WEEK_MS = 7 * 86_400_000;

export type LogsEvent = { id: string; at: string; who: Department; text: string };
export type LogsCredit = { id: string; at: string; delta: number; reason: string };
/** `spent`: credits work used in the last 7 days, net of what came back; `returned`: what came back in that time. */
export type Logs = { events: LogsEvent[]; credits: LogsCredit[]; week: { spent: number; returned: number } };

/**
 * The Logs drawer: what the CMO and its departments did (work_order_events) and every credit that moved
 * (credit_ledger), newest first. Both read under the founder's RLS, so a founder only ever sees their own rows.
 */
export const GET = withApi({}, async ({ supabase }) => {
  if (!UI_V2) throw notFound();
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const [events, credits, week] = await Promise.all([
    supabase.from("work_order_events").select("id, at, department, text").order("at", { ascending: false }).limit(LIMIT),
    supabase.from("credit_ledger").select("id, created_at, delta, reason").order("created_at", { ascending: false }).limit(LIMIT),
    // Work's own rows only (holds, settles, refunds carry a ref): payments and their clawbacks are not spending.
    supabase.from("credit_ledger").select("delta").not("ref_kind", "is", null).gte("created_at", since).limit(10_000),
  ]);
  if (events.error) throw events.error;
  if (credits.error) throw credits.error;
  if (week.error) throw week.error;

  const known = new Set<string>(DEPARTMENTS);
  let eventRows = (events.data ?? []).map((r) => ({
    id: String(r.id),
    at: new Date(r.at as string).toISOString(),
    who: (known.has(r.department as string) ? r.department : "brain") as Department,
    text: String(r.text ?? "").slice(0, 300),
  }));
  let creditRows = (credits.data ?? []).map((r) => ({
    id: String(r.id),
    at: new Date(r.created_at as string).toISOString(),
    delta: Number(r.delta),
    reason: String(r.reason ?? "").slice(0, 200),
  }));
  // Each list is capped on its own; a full one stops earlier in time. Cut both at the later cut-off so the merged
  // timeline never shows a stretch where only one kind of row seems to exist.
  const oldest = (rows: { at: string }[]) => (rows.length === LIMIT ? rows[rows.length - 1]!.at : "");
  const cutoff = [oldest(eventRows), oldest(creditRows)].sort().pop() ?? "";
  if (cutoff) {
    eventRows = eventRows.filter((r) => r.at >= cutoff);
    creditRows = creditRows.filter((r) => r.at >= cutoff);
  }

  let net = 0;
  let returned = 0;
  for (const r of week.data ?? []) {
    const delta = Number(r.delta);
    net += delta;
    if (delta > 0) returned += delta;
  }
  return { events: eventRows, credits: creditRows, week: { spent: Math.max(0, -net), returned } } satisfies Logs;
});
