/**
 * CMO chat → editor handoff (plan 2026-11-02-cmo-chat-editor-handoff): the tools read under RLS, open the editor only
 * on a clip that exists, start a New edit through the button's RPC and limit, wait for the founder after outside
 * content.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/cmo-editor.check.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@/lib/api/handler";

import { EDITOR_TOOLS, runEditorTool } from "./cmo-editor";
import { CMO_TOOL_SPECS, TAINT_GATED_TOOLS, isCmoWrite } from "./cmo-tools";
import { panelHref } from "./panel";

const CLIP = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NEW = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

/** Clips under RLS: only `owned` exist for this founder. RPC calls are recorded. */
function fakeClient(owned: string[], rpcs: { name: string; args: unknown }[]): SupabaseClient {
  return {
    from: () => {
      let id = "";
      const query = {
        select: () => query,
        eq: (_: string, value: string) => ((id = value), query),
        maybeSingle: async () => ({ data: owned.includes(id) ? { id } : null, error: null }),
      };
      return query;
    },
    rpc: async (name: string, args: unknown) => {
      rpcs.push({ name, args });
      if (name === "rate_limit_hit") return { data: true, error: null };
      return { data: NEW, error: null };
    },
  } as unknown as SupabaseClient;
}

async function main() {
  const rpcs: { name: string; args: unknown }[] = [];
  const client = fakeClient([CLIP], rpcs);

  const opened = await runEditorTool(client, "open_editor", { clip_id: CLIP, prompt: "Make a 30-second demo with captions" });
  assert.ok(opened.ok);
  assert.equal(panelHref(opened.view?.open), `/app/editor/${CLIP}?ask=Make+a+30-second+demo+with+captions&send=1`, "the owner's default: the request is sent");
  assert.equal(rpcs.length, 0, "opening a clip writes nothing");

  const missing = await runEditorTool(client, "open_editor", { clip_id: NEW });
  assert.ok(!missing.ok && missing.view === undefined, "a clip the founder cannot read never opens");

  const created = await runEditorTool(client, "open_editor", { new_edit: { name: "Launch demo", aspect: "16:9" } });
  assert.ok(created.ok);
  assert.equal(panelHref(created.view?.open), `/app/editor/${NEW}`);
  assert.deepEqual(rpcs.map((call) => call.name), ["rate_limit_hit", "create_blank_edit"], "the New edit button's limit and RPC");
  assert.deepEqual(rpcs[0]!.args, { p_bucket: "project-write", p_limit: 60, p_window_seconds: 3600 });

  for (const bad of [{}, { clip_id: CLIP, new_edit: {} }, { clip_id: "x" }, { clip_id: CLIP, prompt: "x".repeat(2001) }]) {
    const outcome = await runEditorTool(client, "open_editor", bad);
    assert.ok(!outcome.ok && outcome.content.includes("INVALID_INPUT"), JSON.stringify(bad).slice(0, 60));
  }

  // The tools sit at the end of the list, and wait for the founder after outside content.
  assert.deepEqual(CMO_TOOL_SPECS.slice(-EDITOR_TOOLS.size).map((spec) => spec.name), [...EDITOR_TOOLS]);
  assert.ok(isCmoWrite("open_editor") && TAINT_GATED_TOOLS.has("open_editor"));

  console.log("cmo-editor.check ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
