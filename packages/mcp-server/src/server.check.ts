/**
 * Checks of the MCP server that need no database: `npm run test --workspace @opencmo/mcp-server`.
 * The flows against Supabase (price → confirm → generation, previews, checkpoints) run over a real
 * server in the PR's end-to-end steps (docs/mcp-agent-team-sessions.md, A10).
 */

import assert from "node:assert/strict";

import { z } from "zod";

import { ConfirmError, read, sign } from "./confirm";
import type { Caller } from "./auth";
import { handle, PAID_PLAN_ERROR } from "./http";
import { registerGroup, registry } from "./registry";
import { callTool, describeTool, INSTRUCTIONS } from "./server";

// Read when called, not at import: set before anything runs.
process.env.SUPABASE_JWT_SECRET = "check-secret-check-secret-check-secret";
process.env.OPENCMO_MCP_CONFIRM_KEY = "check-confirm-key-check-confirm-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
delete process.env.OPENCMO_MCP_URL;
delete process.env.OPENCMO_OAUTH_ISSUER;

/** A client whose every query fails: the catalog falls back to the JSON, nothing reads a row. */
const offline = new Proxy(
  {},
  {
    get: (_target, key) => {
      if (key === "rpc") return async (name: string, args: { p_nonce?: string }) => (name === "mcp_confirm_use" ? { data: !used.has(args.p_nonce!) && Boolean(used.add(args.p_nonce!)), error: null } : { data: null, error: { message: "offline" } });
      if (key === "from") return () => new Proxy({}, { get: (_t, method) => (method === "then" ? undefined : () => chain) });
      return undefined;
    },
  },
);
const used = new Set<string>();
const chain: unknown = new Proxy(() => undefined, {
  get: (_t, key) => (key === "then" ? (resolve: (value: unknown) => void) => resolve({ data: null, error: { message: "offline" } }) : () => chain),
  apply: () => chain,
});
const ctx = {
  supabase: offline as never,
  userId: "11111111-1111-4111-8111-111111111111",
};

async function main() {
// ------------------------------------------------------------ confirm codes

{
  const code = sign(ctx.userId, "tool:a", { spec: "x".repeat(20_000) });
  assert.ok(code.length < 2_000, "payloads are deflated: a repetitive spec stays a short code");
  assert.deepEqual(read(code, ctx.userId, "tool:a"), { spec: "x".repeat(20_000) });
  assert.throws(() => read(code, "22222222-2222-4222-8222-222222222222", "tool:a"), ConfirmError, "another user");
  assert.throws(() => read(code, ctx.userId, "tool:b"), ConfirmError, "another tool or clip");
  assert.throws(() => read(`${code.slice(0, -2)}xx`, ctx.userId, "tool:a"), ConfirmError, "a changed signature");
  const [body, signature] = code.split(".");
  assert.throws(() => read(`${body}A.${signature}`, ctx.userId, "tool:a"), ConfirmError, "a changed body");
  assert.throws(() => read(sign(ctx.userId, "tool:a", 1, 600, Date.now() - 601_000), ctx.userId, "tool:a"), /expired/, "an old price");
  // Its own key, no fallback to the JWT secret: without it nothing is signed or read.
  const confirmKey = process.env.OPENCMO_MCP_CONFIRM_KEY;
  delete process.env.OPENCMO_MCP_CONFIRM_KEY;
  assert.throws(() => sign(ctx.userId, "tool:a", 1), /OPENCMO_MCP_CONFIRM_KEY/, "signing fails closed without the confirm key");
  assert.throws(() => read(code, ctx.userId, "tool:a"), /OPENCMO_MCP_CONFIRM_KEY/, "reading fails closed without the confirm key");
  process.env.OPENCMO_MCP_CONFIRM_KEY = confirmKey;
}

// ------------------------------------------------------------ the tool list

const tools = await registry.tools(ctx);
const names = tools.map((tool) => tool.name);
assert.equal(new Set(names).size, names.length, "tool names are unique");
for (const name of ["list_projects", "list_clips", "new_edit", "open_in_editor", "get_project_state", "add_text", "remove_words", "check", "export_clip", "get_export", "get_generation", "get_explainer_kit", "read_guide", "read_skill", "save_skill", "find_icons", "find_lotties", "wait_for_media", "plan_video"]) {
  assert.ok(names.includes(name), `${name} is offered`);
}
for (const name of ["capture", "media_waveform", "preview_3d", "save_frame", "media_grab", "inspect_color", "ask_user", "update_plan", "undo", "request_export"]) {
  assert.ok(!names.includes(name), `${name} is not offered over MCP`);
}
for (const tool of tools) {
  const described = describeTool(tool);
  assert.equal(described.inputSchema.type, "object", `${tool.name}: an object schema`);
  assert.ok(described.description && described.description.length > 20, `${tool.name}: described`);
  if (tool.costsCredits) {
    assert.ok(tool.price, `${tool.name}: priced tools have a price step`);
    assert.ok("confirm" in (described.inputSchema.properties ?? {}), `${tool.name}: takes confirm`);
    assert.deepEqual(described.inputSchema.required ?? [], tool.inputJsonSchema ? ["clip_id"] : [], `${tool.name}: the confirm call needs only clip_id`);
    assert.match(described.description!, /two steps/, `${tool.name}: says it costs credits`);
  }
  if (tool.outputSchema) assert.equal(described.outputSchema?.type, "object", `${tool.name}: an object output schema`);
}
const byName = Object.fromEntries(tools.map((tool) => [tool.name, describeTool(tool)]));
if (byName.create_video) assert.ok(byName.create_video.description!.includes("You are the director"), "create_video takes Claude's plan");
assert.ok((byName.plan_video!.inputSchema.properties as Record<string, unknown>).spec, "plan_video takes Claude's IntroSpec");
assert.equal(byName.get_project_state!.annotations?.readOnlyHint, true, "reads are read-only");
assert.equal(byName.remove_words!.annotations?.destructiveHint, true, "cuts are destructive");
assert.equal(byName.add_text!.annotations?.readOnlyHint, false, "writes are not read-only");
assert.match(INSTRUCTIONS, /Never confirm on your own/);

// ------------------------------------------------------------ the client's plan is required

{
  const planVideo = tools.find((tool) => tool.name === "plan_video")!;
  const missing = await callTool(planVideo, { clip_id: "11111111-1111-4111-8111-111111111111", recipe: "intro", brief: "calm" }, ctx);
  assert.equal(missing.isError, true, "plan_video without spec never reaches our motion team");
  assert.match(String((missing.content[0] as { text: string }).text), /^spec: /);
}

// ------------------------------------------------------------ price → confirm, enforced by the server

{
  const runs: unknown[] = [];
  registerGroup({
    tools: [
      {
        name: "check_priced",
        title: "Priced check tool",
        description: "A priced tool used only by these checks.",
        inputSchema: z.object({ clip_id: z.string(), words: z.string().min(2) }),
        annotations: {},
        costsCredits: true,
        price: async (input) => ({ credits: 3, lines: ["Make it"], prepared: { quoted: (input as { words: string }).words } }),
        run: async (input) => {
          runs.push(input);
          return { content: [{ type: "text", text: "made" }] };
        },
      },
    ],
  });
  const tool = (await registry.tools(ctx)).find((item) => item.name === "check_priced")!;
  const bad = await callTool(tool, { clip_id: "c1", words: "x" }, ctx);
  assert.equal(bad.isError, true, "the price step validates the input");
  const quote = await callTool(tool, { clip_id: "c1", words: "hello" }, ctx);
  const body = quote.structuredContent as { price_credits: number; confirm: string };
  assert.equal(body.price_credits, 3);
  assert.equal(runs.length, 0, "the price step runs nothing");
  const other = await callTool(tool, { clip_id: "c2", confirm: body.confirm }, ctx);
  assert.equal(other.isError, true, "a code is bound to its clip");
  const done = await callTool(tool, { clip_id: "c1", words: "changed", confirm: body.confirm }, ctx);
  assert.equal(done.isError, undefined);
  assert.deepEqual(runs, [{ quoted: "hello" }], "run gets what was quoted, not the new arguments");
  const again = await callTool(tool, { clip_id: "c1", confirm: body.confirm }, ctx);
  assert.match(String((again.content[0] as { text: string }).text), /already used/, "a code works once");
  assert.equal(runs.length, 1);
}

// ------------------------------------------------------------ HTTP

{
  const anonymous = await handle(new Request("http://mcp.test/mcp", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/mcp\.test\/\.well-known\/oauth-protected-resource"/);
  const metadata = (await (await handle(new Request("http://mcp.test/.well-known/oauth-protected-resource"))).json()) as { resource: string; authorization_servers: string[] };
  assert.equal(metadata.resource, "http://mcp.test/mcp");
  assert.deepEqual(metadata.authorization_servers, ["http://127.0.0.1:54321/auth/v1"]);
  assert.equal((await handle(new Request("http://mcp.test/mcp"))).status, 405, "GET: no server stream");
  assert.equal((await handle(new Request("http://mcp.test/healthz"))).status, 200);
  assert.equal((await handle(new Request("http://mcp.test/other"))).status, 404);
  assert.equal((await handle(new Request("http://mcp.test/mcp", { method: "OPTIONS" }))).headers.get("access-control-allow-origin"), "*");
}

// ------------------------------------------------------------ admission: one call per request

{
  const calls: { name: string; args: unknown }[] = [];
  const callerAnswering = (answer: string): Caller => ({
    userId: ctx.userId,
    via: "api_key",
    supabase: {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: answer, error: null };
      },
    } as never,
  });
  const post = (body: unknown, answer: string) =>
    handle(
      new Request("http://mcp.test/mcp", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer x" } }),
      async () => callerAnswering(answer),
    );
  const pings = (count: number) => Array.from({ length: count }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" }));

  const batch = await post(pings(20), "ok");
  assert.equal(batch.status, 200);
  assert.deepEqual(calls, [{ name: "mcp_admit", args: { p_count: 20 } }], "a batch of 20 makes one admission call");

  calls.length = 0;
  assert.equal((await post(pings(21), "ok")).status, 400, "more than 20 messages");
  assert.equal(calls.length, 0, "an oversized batch is refused before the database");

  const free = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } }, "free_plan");
  assert.equal(free.status, 403, "free accounts cannot use MCP, initialize included");
  assert.deepEqual(await free.json(), { jsonrpc: "2.0", id: null, error: PAID_PLAN_ERROR });
  assert.equal(PAID_PLAN_ERROR.message, "OpenCMO's MCP connection is part of the paid plans. Upgrade on the Credits page.");

  assert.equal((await post(pings(1), "rate_limited")).status, 429);
  assert.equal((await post(pings(1), "something else")).status, 503, "an unknown answer fails closed");
}

// ------------------------------------------------------------ prompts and resources

{
  const explain = registry.prompt("explain")!;
  const text = explain.render({ request: "how a vaccine works, 30 s", clip_id: "abc" });
  assert.match(text, /how a vaccine works/);
  assert.match(text, /<guide name="explainer">/);
  assert.match(text, /storyboard/);
  for (const name of ["explain", "video", "roughcut", "broll", "intro"]) assert.ok(registry.prompt(name), `prompt /${name}`);
  const uris = registry.resources().map((resource) => resource.uri);
  assert.ok(uris.includes("opencmo://guides/explainer") && uris.includes("opencmo://guides/motion") && uris.includes("opencmo://kit/explainer"));
  const kit = await registry.resource("opencmo://kit/explainer")!.read(ctx);
  assert.match(kit, /^# Explainer scene-code kit/);
  assert.ok(!kit.includes("## 4."), "the kit is the code section only");
  assert.deepEqual(registry.templates().map((template) => template.uriTemplate), ["opencmo://skills/mine/{name}"]);
}

console.log(`mcp-server checks passed (${names.length} tools, ${registry.prompts().length} prompts, ${registry.resources().length} resources)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
