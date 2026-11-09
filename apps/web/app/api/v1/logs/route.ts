import { notFound, withApi } from "@/lib/api/handler";
import { DEPARTMENTS, type Department } from "@/lib/screens/common";
import { UI_V2 } from "@/lib/screens/flag";

export const dynamic = "force-dynamic";

const LIMIT = 100;

export type LogsEvent = { id: string; at: string; who: Department; text: string };
export type LogsCredit = { id: string; at: string; delta: number; reason: string };
export type Logs = { events: LogsEvent[]; credits: LogsCredit[] };

/**
 * The Logs drawer: what the CMO and its departments did (work_order_events) and every credit that moved
 * (credit_ledger), newest first. Both read under the founder's RLS, so a founder only ever sees their own rows.
 */
export const GET = withApi({}, async ({ supabase }) => {
  if (!UI_V2) throw notFound();
  const [events, credits] = await Promise.all([
    supabase.from("work_order_events").select("id, at, department, text").order("at", { ascending: false }).limit(LIMIT),
    supabase.from("credit_ledger").select("id, created_at, delta, reason").order("created_at", { ascending: false }).limit(LIMIT),
  ]);
  if (events.error) throw events.error;
  if (credits.error) throw credits.error;
  const known = new Set<string>(DEPARTMENTS);
  return {
    events: (events.data ?? []).map((r) => ({
      id: String(r.id),
      at: new Date(r.at as string).toISOString(),
      who: (known.has(r.department as string) ? r.department : "brain") as Department,
      text: String(r.text ?? "").slice(0, 300),
    })),
    credits: (credits.data ?? []).map((r) => ({
      id: String(r.id),
      at: new Date(r.created_at as string).toISOString(),
      delta: Number(r.delta),
      reason: String(r.reason ?? "").slice(0, 200),
    })),
  } satisfies Logs;
});
