/**
 * The chat writes a post from a Sales conversation (owner, 2026-11-24): `list_conversations` names each conversation by
 * the Library line our model wrote, never the stranger's title, text or url, and taints the turn (that line came from a
 * stranger's post); `list_approvals` keeps computed fields only, so a decision after it is not gated. `create_task`
 * hands the id to the writer.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/cmo-sales-post.check.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@/lib/api/handler";

import { TAINTING_TOOLS, runCmoTool } from "./cmo-tools";

const OPP = "5b0c7a7e-1f9e-4c3e-9a51-2d1f7b6c0a11";

/** A query builder that answers every chain with the rows of its table, and records the columns asked for. */
function fakeSupabase(tables: Record<string, unknown[]>, rpcs: { name: string; args: Record<string, unknown> }[]) {
  const selected: Record<string, string[]> = {};
  const from = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["eq", "neq", "in", "not", "gte", "lte", "order", "limit", "is"]) chain[method] = () => chain;
    chain.select = (columns: string) => ((selected[table] ??= []).push(columns), chain);
    chain.maybeSingle = async () => ({ data: (result.data as unknown[])[0] ?? null, error: null });
    chain.then = (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    return { data: { id: "run-1", status: "running" }, error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, selected };
}

async function main() {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const { client, selected } = fakeSupabase(
    {
      opportunities: [{ id: OPP, platform: "reddit", community: "SaaS", score: 82, priority: "high", status: "in_review", created_at: "2026-11-24T08:00:00Z" }],
      library_entries: [{ opportunity_id: OPP, summary: "A founder with no audience asks where to find first customers.", theme: { name: "Finding first customers" } }],
      content_items: [],
      approvals: [],
    },
    rpcs,
  );

  const approvals = await runCmoTool(client, "list_approvals", {});
  assert.ok(approvals.ok);
  const plain = (JSON.parse(approvals.content) as { untrusted_data: { sales_conversations: Record<string, unknown>[] } }).untrusted_data.sales_conversations[0]!;
  assert.ok(!("summary" in plain) && !("theme" in plain), "list_approvals carries no model text from a stranger's post");
  assert.ok(!TAINTING_TOOLS.has("list_approvals"), "so a decision after it is not gated");

  const listed = await runCmoTool(client, "list_conversations", {});
  assert.ok(listed.ok);
  assert.ok(TAINTING_TOOLS.has("list_conversations"), "list_conversations taints the turn");
  const conversation = (JSON.parse(listed.content) as { untrusted_data: { conversations: Record<string, unknown>[] } }).untrusted_data.conversations[0]!;
  assert.equal(conversation.id, OPP);
  assert.equal(conversation.summary, "A founder with no audience asks where to find first customers.");
  assert.equal(conversation.theme, "Finding first customers");
  for (const key of ["title", "snippet", "author", "url"]) assert.ok(!(key in conversation), `no ${key} in a conversation`);
  for (const columns of selected.opportunities ?? []) assert.doesNotMatch(columns, /\b(title|snippet|author|url)\b/, "the stranger's words are never read");

  // Only the writer takes a conversation, and only now.
  const sales = await runCmoTool(client, "create_task", { agent: "sales", brief: "Find more people", opportunity_id: OPP });
  assert.ok(!sales.ok && sales.content.includes("x_writer only"));
  const later = await runCmoTool(client, "create_task", { agent: "x_writer", brief: "A post on first customers", when: "2026-11-30", opportunity_id: OPP });
  assert.ok(!later.ok && later.content.includes("written now"));
  const notId = await runCmoTool(client, "create_task", { agent: "x_writer", brief: "A post on first customers", opportunity_id: "https://reddit.com/r/SaaS" });
  assert.ok(!notId.ok && notId.content.includes("not a url"), "an id, not a url, and it says so");
  assert.equal(rpcs.length, 0, "nothing was queued for a refused task");

  const started = await runCmoTool(client, "create_task", { agent: "x_writer", brief: "A post on how to find first customers", when: "now", opportunity_id: OPP });
  assert.ok(started.ok, started.content);
  const enqueued = rpcs.find((r) => r.name === "enqueue_cmo_run")!;
  assert.equal(enqueued.args.p_kind, "post_draft");
  assert.equal((enqueued.args.p_input as Record<string, unknown>).opportunity_id, OPP);

  console.log("cmo-sales-post.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
