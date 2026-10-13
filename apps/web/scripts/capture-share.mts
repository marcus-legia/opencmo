/**
 * Share of Assistant turn time spent in `capture` round trips (the request ends, the tab draws the
 * frames, a new request resumes the turn). Run against the LOCAL database after the user scenarios:
 *
 *   eval "$(supabase status -o env | sed 's/^/export /')"
 *   SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npx tsx scripts/capture-share.mts
 *
 * `agent_tool_calls` has no finish time, so a round trip is measured up to the next row of the turn
 * (a tool call or a message), or to the end of the turn.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Reads every user's turns with the service role: local stack only.
if (!url || !key || !/\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("Point SUPABASE_URL at the local stack.");
const db = createClient(url, key);

const { data: turns, error } = await db.from("agent_turns").select("id, created_at, finished_at").not("finished_at", "is", null);
if (error) throw error;

let total = 0;
let spent = 0;
let captures = 0;
for (const turn of turns ?? []) {
  const [calls, messages] = await Promise.all([
    db.from("agent_tool_calls").select("name, created_at").eq("turn_id", turn.id),
    db.from("agent_messages").select("created_at").eq("turn_id", turn.id),
  ]);
  if (calls.error) throw calls.error;
  if (messages.error) throw messages.error;
  const rows = [
    ...(calls.data ?? []).map((row) => ({ name: row.name as string, at: Date.parse(row.created_at as string) })),
    ...(messages.data ?? []).map((row) => ({ name: "", at: Date.parse(row.created_at as string) })),
  ].sort((a, b) => a.at - b.at);
  const end = Date.parse(turn.finished_at as string);
  total += end - Date.parse(turn.created_at as string);
  rows.forEach((row, index) => {
    if (row.name !== "capture") return;
    captures++;
    // Rows written in the same statement share a timestamp: the round trip ends at the next later row.
    const next = rows.slice(index + 1).find((later) => later.at > row.at);
    spent += (next?.at ?? end) - row.at;
  });
}
const share = total ? (100 * spent) / total : 0;
console.log(`capture share: ${share.toFixed(1)}% of ${Math.round(total / 1000)}s over ${turns?.length ?? 0} turns (${captures} captures)`);
