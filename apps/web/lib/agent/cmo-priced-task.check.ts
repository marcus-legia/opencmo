/**
 * Charge before running (cmo-review-2 S3.5): a Sales scan or competitor research asked for in the CMO chat stops at a
 * card with its price, and nothing is queued or held until the founder approves it.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/agent/cmo-priced-task.check.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@/lib/api/handler";
import { JOB_PRICES } from "@/lib/cmo/jobs/progress";

import { pricedTaskCard } from "./cmo-tools";
import { cmoScope } from "./scope";

const RUN = "33333333-3333-4333-8333-333333333333";

/**
 * Records every RPC; `enqueue_cmo_run` answers a finished run so no background drain starts. `platforms`: the
 * founder's saved Sales switches (`sales_settings.platforms`); undefined is a founder who never saved any.
 */
function fake(platforms?: string[]) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const query = { select: () => query, maybeSingle: async () => ({ data: platforms ? { platforms } : null, error: null }) };
  const client = {
    from: () => query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return { data: { id: RUN, kind: args.p_kind, status: "done", created_at: "2026-11-08T10:00:00Z" }, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, rpcs };
}

async function main() {
  process.env.SCRAPECREATORS_API_KEY = "sc-test";
  const call = (input: Record<string, unknown>) => ({ id: "toolu_1", name: "create_task", input });

  // The card: its price is the job's, and it says what the scan searches.
  const sales = pricedTaskCard({ agent: "sales", brief: "Founders who chase late invoices", when: "now" });
  assert.equal(sales?.card.credits, JOB_PRICES.sales_scan);
  assert.equal(sales?.card.credits, 5);
  assert.ok(sales?.card.changes[0]?.includes("Founders who chase late invoices"));
  assert.ok(sales?.card.changes.some((line) => /searches/i.test(line)), "the card says what it will search");
  const research = pricedTaskCard({ agent: "research", brief: "What hooks work for them", handles: ["@rival"] });
  assert.equal(research?.card.credits, JOB_PRICES.competitor_research);
  assert.ok(research?.card.changes.some((line) => line.includes("@rival")));

  // No card: a draft or a plan (1 credit, the CMO's everyday work), a dated task (a calendar item), input it refuses.
  for (const input of [
    { agent: "x_writer", brief: "A post about pricing", when: "now" },
    { agent: "planner", brief: "A balanced week", when: "now" },
    { agent: "sales", brief: "Founders who chase late invoices", when: "2026-11-10" },
    { agent: "sales", brief: "x" },
    // create_task refuses `thread` on sales: refused at once, not after the founder approved a card.
    { agent: "sales", brief: "Founders who chase late invoices", when: "now", thread: true },
    // `have_video` belongs to video: no 5-credit card for a task create_task would then refuse (review of #188).
    { agent: "sales", brief: "Founders who chase late invoices", when: "now", have_video: true },
    // A video the founder already has is a free reminder, not a script.
    { agent: "video", brief: "Post the demo I recorded", have_video: true },
  ]) assert.equal(pricedTaskCard(input), null, JSON.stringify(input));
  // Sales finder C1: the card names the places asked for; platforms belong to sales, and only known ones pass.
  assert.ok(pricedTaskCard({ agent: "sales", brief: "find x", platforms: ["threads"] })?.card.changes[0]?.startsWith("Scan Threads"));
  assert.equal(pricedTaskCard({ agent: "x_writer", brief: "x", platforms: ["reddit"] }), null);
  assert.equal(pricedTaskCard({ agent: "research", brief: "What hooks work", platforms: ["reddit"] }), null, "research takes no platforms");
  assert.equal(pricedTaskCard({ agent: "sales", brief: "find x", platforms: ["x"] }), null, "X is not a place Sales looks");
  assert.equal(pricedTaskCard({ agent: "sales", brief: "find x", platforms: [] }), null, "an empty list is refused");
  assert.equal(pricedTaskCard({ agent: "sales", brief: "find x" }, ["reddit", "hn"])?.card.changes[0], "Scan Reddit and Hacker News: find x", "only the switches that are on");
  // A script (I0) is priced on any day: the day is when the founder means to film.
  const script = pricedTaskCard({ agent: "video", brief: "A 30 second demo", when: "2026-11-20" });
  assert.equal(script?.card.credits, JOB_PRICES.write_video_brief);

  // In the chat: the scan asked for stops at a card, and nothing is queued or held.
  const { client, rpcs } = fake();
  const scope = cmoScope(client);
  const asked = call({ agent: "sales", brief: "Founders who chase late invoices", when: "now" });
  const plan = await scope.plan!(asked);
  assert.equal(plan.kind, "approval", "a scan asked in chat stops at a card");
  assert.equal(plan.kind === "approval" ? plan.card?.credits : undefined, 5);
  assert.equal(rpcs.length, 0, "nothing runs before the card is approved");
  assert.equal((await scope.plan!(call({ agent: "x_writer", brief: "A post about pricing", when: "now" }))).kind, "run", "a draft still runs at once");

  // Declined: nothing runs. Approved: the task as priced is queued, once.
  const input = plan.kind === "approval" ? plan.input : null;
  const declined = await scope.decide!(asked, input, false);
  assert.equal(declined.wrote, false);
  assert.equal(rpcs.length, 0, "a declined card spends nothing");
  const approved = await scope.decide!({ ...asked, input: { agent: "sales", brief: "something else entirely", when: "now" } }, input, true);
  assert.equal(approved.outcome.ok, true, approved.outcome.content);
  const queued = rpcs.filter((rpc) => rpc.name === "enqueue_cmo_run");
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.args.p_kind, "sales_scan");
  assert.equal((queued[0]?.args.p_input as { brief?: string }).brief, "Founders who chase late invoices", "the task on the card runs, not a changed one");

  // Review focus 4: a scan asked only where the founder turned Sales off is refused at the card, and again at run,
  // before anything is queued or held.
  const off = fake(["reddit"]);
  const offScope = cmoScope(off.client);
  const threadsOnly = call({ agent: "sales", brief: "Founders who chase late invoices", when: "now", platforms: ["threads"] });
  const refused = await offScope.plan!(threadsOnly);
  assert.equal(refused.kind, "invalid");
  assert.match(refused.kind === "invalid" ? refused.content : "", /Sales is turned off for Threads\. Turn it on in Sales settings/);
  const { runCmoTool } = await import("./cmo-tools");
  const direct = await runCmoTool(off.client, "create_task", threadsOnly.input);
  assert.ok(!direct.ok && /turned off for Threads/.test(direct.content), direct.content);
  const dated = await runCmoTool(off.client, "create_task", { agent: "sales", brief: "Founders who chase late invoices", when: "2026-11-20", platforms: ["reddit"] });
  assert.ok(!dated.ok && /later day uses your Sales settings/.test(dated.content), "a dated scan does not drop the places asked for");
  assert.equal(off.rpcs.length, 0, "nothing queued or held");
  // With Reddit on, the card names Reddit only, and the run is asked for the places the founder named.
  const onePlace = await offScope.plan!(call({ agent: "sales", brief: "Founders who chase late invoices", when: "now" }));
  assert.equal(onePlace.kind === "approval" ? onePlace.card?.changes[0] : null, "Scan Reddit: Founders who chase late invoices");
  const named = await runCmoTool(fake(["reddit", "threads"]).client, "create_task", threadsOnly.input);
  assert.ok(named.ok, named.content);
  assert.equal(JSON.parse(named.content).run_id, RUN);

  delete process.env.SCRAPECREATORS_API_KEY;
  console.log("cmo priced tasks: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
