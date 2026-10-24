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
// Motion templates need no clip (B5).
for (const name of ["list_motion_templates", "get_motion_template"]) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `${name} is offered`);
  assert.ok(!("clip_id" in (describeTool(tool).inputSchema.properties ?? {})), `${name} needs no clip`);
}
assert.match(JSON.stringify((await callTool(tools.find((item) => item.name === "get_motion_template")!, { id: "nope" }, ctx)).content), /use one of analytics-glow/);
for (const name of ["list_projects", "list_clips", "new_edit", "open_in_editor", "get_project_state", "add_text", "remove_words", "check", "export_clip", "get_export", "get_generation", "get_explainer_kit", "read_guide", "read_skill", "save_skill", "find_icons", "find_lotties", "wait_for_media", "plan_video"]) {
  assert.ok(names.includes(name), `${name} is offered`);
}
// Browser-only in the app; over MCP `capture` is `capture_frame`, and the look group draws on the worker.
for (const name of ["capture_frame", "inspect_color", "media_grab", "media_waveform", "save_frame", "list_versions", "restore_version"]) assert.ok(names.includes(name), `${name} is offered`);
for (const name of ["capture", "preview_3d", "ask_user", "update_plan", "undo", "request_export"]) {
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
  const fake = process.env.OPENCMO_AI_FAKE;
  process.env.OPENCMO_AI_FAKE = "1";
  const createVideo = (await registry.tools(ctx)).find((tool) => tool.name === "create_video");
  assert.ok(createVideo, "create_video is offered when video models are available");
  const noPlan = await callTool(createVideo, { clip_id: "11111111-1111-4111-8111-111111111111", prompt: "a video about our app" }, ctx);
  assert.equal(noPlan.isError, true, "create_video without a plan never reaches our director");
  assert.match(String((noPlan.content[0] as { text: string }).text), /^plan: Send your finished plan/);
  const described = describeTool(createVideo);
  assert.match(described.description!, /keyframes only/, "the price step says it is the keyframes");
  const shot = (described.inputSchema.properties as { plan: { properties: { shots: { items: { properties: Record<string, unknown> } } } } }).plan.properties.shots.items.properties;
  for (const field of ["words", "keyframe", "motion", "continues"]) assert.ok(field in shot, `the plan's shots take ${field}`);
  if (fake === undefined) delete process.env.OPENCMO_AI_FAKE;
  else process.env.OPENCMO_AI_FAKE = fake;
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

// ------------------------------------------------------------ explainers: the direction comes first (motion quality A3)

{
  const fake = process.env.OPENCMO_AI_FAKE;
  process.env.OPENCMO_AI_FAKE = "1";
  const preview = (await registry.tools(ctx)).find((tool) => tool.name === "preview_explainer");
  assert.ok(preview, "preview_explainer is offered when explainers are available");
  const schema = describeTool(preview).inputSchema as { properties: Record<string, { description?: string }>; required: string[] };
  assert.ok(schema.required.includes("direction"), "an MCP client must send a direction");
  const keys = Object.keys(schema.properties);
  assert.ok(keys.indexOf("direction") < keys.indexOf("code"), "direction is listed before code");
  assert.match(schema.properties.direction!.description ?? "", /from → to/);
  assert.match(describeTool(preview).description!, /up to 6 rounds/);
  if (fake === undefined) delete process.env.OPENCMO_AI_FAKE;
  else process.env.OPENCMO_AI_FAKE = fake;
}

// ------------------------------------------------------------ the kit with silent clips only (no narration voice)

{
  const saved = { motion: process.env.OPENCMO_MOTION, eleven: process.env.ELEVENLABS_API_KEY, voice: process.env.OPENCMO_VOICE_ENABLED, fakeVoice: process.env.OPENCMO_MOTION_FAKE_VOICE, fake: process.env.OPENCMO_AI_FAKE };
  process.env.OPENCMO_MOTION = "modal";
  for (const key of ["ELEVENLABS_API_KEY", "OPENCMO_VOICE_ENABLED", "OPENCMO_MOTION_FAKE_VOICE", "OPENCMO_AI_FAKE"]) delete process.env[key];
  const kit = (await registry.tools(ctx)).find((tool) => tool.name === "get_explainer_kit")!;
  const result = (await callTool(kit, {}, ctx)) as unknown as { isError?: boolean; structuredContent: { available: boolean; narrated: boolean; silent_clip: unknown } };
  assert.equal(result.isError ?? false, false, "silent clips alone are not an error");
  assert.equal(result.structuredContent.available, true);
  assert.equal(result.structuredContent.narrated, false);
  assert.equal(typeof result.structuredContent.silent_clip, "object", "the silent clip section says how to make one");
  for (const [key, value] of Object.entries({ OPENCMO_MOTION: saved.motion, ELEVENLABS_API_KEY: saved.eleven, OPENCMO_VOICE_ENABLED: saved.voice, OPENCMO_MOTION_FAKE_VOICE: saved.fakeVoice, OPENCMO_AI_FAKE: saved.fake })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

// ------------------------------------------------------------ look (editor-MCP plan, item 1)

{
  const capture = tools.find((tool) => tool.name === "capture_frame")!;
  assert.equal(byName.capture_frame!.annotations?.readOnlyHint, true);
  assert.ok(!capture.costsCredits, "looking is free for the user");
  delete process.env.OPENCMO_LOOK_URL;
  delete process.env.OPENCMO_LOOK_TOKEN;
  const unset = await callTool(capture, { clip_id: "11111111-1111-4111-8111-111111111111", times: [1] }, ctx);
  assert.equal(unset.isError, true);
  assert.match(JSON.stringify(unset.content), /not set up/, "no endpoint: a clear error, never a hang");
  const tooMany = await callTool(capture, { clip_id: "11111111-1111-4111-8111-111111111111", times: Array.from({ length: 13 }, (_, i) => i) }, ctx);
  assert.equal(tooMany.isError, true, "at most 12 frames");
  // The clip is read under RLS first, so a wrong id does not spend the hour's looks; then the cap
  // answers before anything is posted to the worker.
  process.env.OPENCMO_LOOK_URL = "http://127.0.0.1:9/look";
  process.env.OPENCMO_LOOK_TOKEN = "t";
  const hits: string[] = [];
  const lookClient = (clip: unknown) => {
    const project = {
      clip_id: "11111111-1111-4111-8111-111111111111", document_hash: "h", manifest: null, version: 1, updated_at: "now",
      document: { version: 1, stage: { children: [{ kind: "scene", name: "A", width: 1080, height: 1920, fill: "#000000", active: true, workarea: [0, 10], children: [] }] } },
    };
    const rows: Record<string, unknown> = { clips: clip, editor_projects: project };
    const query = (table: string) => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) };
      return builder;
    };
    return { from: query, rpc: async (name: string) => (hits.push(name), { data: false, error: null }) } as never;
  };
  const ownClip = { id: "11111111-1111-4111-8111-111111111111", job_id: "j", idx: 0, kind: "blank", jobs: { id: "j", status: "done", aspect: "9:16", duration_seconds: null, media_manifest: null } };
  const missing = await callTool(capture, { clip_id: "11111111-1111-4111-8111-111111111111" }, { ...ctx, supabase: lookClient(null) });
  assert.match(JSON.stringify(missing.content), /not found/);
  assert.deepEqual(hits, [], "a clip that is not the caller's spends no look");
  const limited = await callTool(capture, { clip_id: "11111111-1111-4111-8111-111111111111" }, { ...ctx, supabase: lookClient(ownClip) });
  assert.match(JSON.stringify(limited.content), /60 times an hour/);
  assert.deepEqual(hits, ["rate_limit_hit"]);
  delete process.env.OPENCMO_LOOK_URL;
  delete process.env.OPENCMO_LOOK_TOKEN;
  const saveFrame = tools.find((tool) => tool.name === "save_frame")!;
  const notSaved = await callTool(saveFrame, { clip_id: "11111111-1111-4111-8111-111111111111", time: 1 }, ctx);
  assert.match(JSON.stringify(notSaved.content), /not set up/, "save_frame stops before reserving anything when looking is not set up");
  assert.equal(byName.restore_version!.annotations?.destructiveHint, true);
  assert.equal(byName.list_versions!.annotations?.readOnlyHint, true);
}

console.log(`mcp-server checks passed (${names.length} tools, ${registry.prompts().length} prompts, ${registry.resources().length} resources)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
