import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { SOURCE_VIDEO } from "./global-setup";
import { makeClipsInEditor, signIn, state } from "./helpers";

/**
 * MCP: an API key made in Settings → an MCP client calls the MCP server (packages/mcp-server, run
 * here as `npm run dev` on port 8787, the same code Modal runs) like Claude Code: list, edit a clip
 * with the Assistant's own tools, generate media in TWO steps (price, then confirm), revoke the key.
 * MCP is part of the paid plans: user A is set to `starter`, user B stays free and gets 403.
 * The old `/api/mcp` route answers 410.
 */

const MCP_PORT = 8787;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; protocolVersion?: string }; error?: { code: number; message: string } };

let server: ChildProcess | null = null;

test.beforeAll(async () => {
  server = spawn("npm", ["run", "dev", "--workspace", "@opencmo/mcp-server"], {
    cwd: join(__dirname, "..", "..", ".."),
    env: { ...process.env, PORT: String(MCP_PORT), HOST: "127.0.0.1", OPENCMO_MCP_URL: MCP_URL, OPENCMO_MCP_CONFIRM_KEY: "e2e-confirm-key-e2e-confirm-key" },
    stdio: "inherit",
    detached: true,
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    const ok = await fetch(`http://127.0.0.1:${MCP_PORT}/healthz`).then((response) => response.ok).catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The MCP server did not start on port 8787.");
});

test.afterAll(() => {
  // npm starts tsx in its own process: end the whole group.
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
});

async function setPlan(userId: string, plan: string): Promise<void> {
  const { url, service } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from("profiles").update({ plan }).eq("id", userId);
  if (error) throw new Error(error.message);
}

async function mcp(page: Page, key: string, method: string, params?: unknown, id = 1): Promise<{ status: number; body: Rpc }> {
  const response = await page.request.post(MCP_URL, {
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) },
  });
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as Rpc };
}

const call = async (page: Page, key: string, name: string, args: Record<string, unknown>) => {
  const { body } = await mcp(page, key, "tools/call", { name, arguments: args });
  const text = body.result?.content?.[0]?.text ?? "";
  return { text, isError: body.result?.isError === true, json: (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })() };
};

async function createKey(page: Page, name: string): Promise<string> {
  await page.goto("/app/settings");
  await page.getByTestId("api-key-name").fill(name);
  await page.getByTestId("api-key-create").click();
  const key = (await page.getByTestId("api-key-created").innerText()).trim();
  expect(key).toMatch(/^ocm_[0-9a-f]{48}$/);
  return key;
}

const initialize = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } };

test("MCP: API key, edit a clip, two-step media generation, revoke", async ({ page }) => {
  test.setTimeout(900_000);
  const user = state().users.a;
  await setPlan(user.id, "starter");
  await signIn(page, user);
  const projectId = await makeClipsInEditor(page, SOURCE_VIDEO);
  const clipId = /\/app\/editor\/([0-9a-f-]+)$/.exec(page.url())![1]!;

  // The retired route points at the new server.
  const old = await page.request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "ping" } });
  expect(old.status()).toBe(410);
  expect(await old.json()).toEqual({ error: "This endpoint moved.", url: MCP_URL });

  // No valid key: 401, nothing leaks.
  expect((await mcp(page, "ocm_" + "0".repeat(48), "initialize", initialize)).status).toBe(401);

  const key = await createKey(page, "E2E MCP");
  await expect(page.getByTestId("api-key-list")).toContainText("E2E MCP");

  const init = await mcp(page, key, "initialize", initialize);
  expect(init.status).toBe(200);
  expect(init.body.result?.protocolVersion).toBe("2025-06-18");
  const tools = (await mcp(page, key, "tools/list")).body.result?.tools?.map((tool) => tool.name) ?? [];
  expect(tools).toEqual(expect.arrayContaining(["list_projects", "list_clips", "get_project_state", "add_text", "generate_media"]));
  expect(tools).not.toContain("capture");
  expect(tools).not.toContain("ask_user");

  expect((await call(page, key, "list_projects", {})).text).toContain(projectId);
  expect((await call(page, key, "list_clips", { project_id: projectId })).text).toContain(clipId);
  expect((await call(page, key, "get_project_state", { clip_id: clipId })).isError).toBe(false);

  // Edits use the Assistant's own tools; each write leaves an "MCP" checkpoint.
  const added = await call(page, key, "add_text", { clip_id: clipId, text: "FROM MCP", start: 0, end: 2 });
  expect(added.isError, added.text).toBe(false);
  const doc = async () => JSON.stringify(await (await page.request.get(`/api/v1/editor/document?clip_id=${clipId}`)).json());
  expect(await doc()).toContain("FROM MCP");
  const history = JSON.stringify(await (await page.request.get(`/api/v1/editor/revisions?clip_id=${clipId}`)).json());
  expect(history).toContain("MCP");

  // Generation: the first call only quotes (no credits, nothing placed), the second with confirm generates.
  const brief = { clip_id: clipId, kind: "image", model: "fake-image", quote: "we built this", idea: "a small team ships fast", subject: "a laptop on a desk at night" };
  const priced = await call(page, key, "generate_media", brief);
  expect(priced.isError, priced.text).toBe(false);
  expect(priced.json?.price_credits).toEqual(expect.any(Number));
  expect(await doc()).not.toContain("a laptop on a desk at night");
  const confirmed = await call(page, key, "generate_media", { clip_id: clipId, confirm: priced.json!.confirm });
  expect(confirmed.isError, confirmed.text).toBe(false);
  expect(confirmed.json?.generation_id).toEqual(expect.any(String));
  expect(await doc()).toContain('"generate":"image"');
  // A hand-edited confirm code is refused, and so is the same code twice.
  const forged = await call(page, key, "generate_media", { clip_id: clipId, confirm: `${String(priced.json!.confirm).slice(0, -2)}xx` });
  expect(forged.isError).toBe(true);
  expect((await call(page, key, "generate_media", { clip_id: clipId, confirm: priced.json!.confirm })).isError).toBe(true);

  // An oversized batch is refused: one POST of many messages cannot get past the rate limit.
  const batch = await page.request.post(MCP_URL, {
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: Array.from({ length: 21 }, (_, index) => ({ jsonrpc: "2.0", id: index, method: "ping" })),
  });
  expect(batch.status()).toBe(400);

  // Revoked: the key gets 401 at once.
  await page.reload();
  await page.getByTestId(`api-key-revoke-${key.slice(0, 12)}`).click();
  await expect(page.getByTestId("api-key-list")).toHaveCount(0);
  expect((await mcp(page, key, "tools/list")).status).toBe(401);
});

test("MCP: a free account is refused with the upgrade message", async ({ page }) => {
  const user = state().users.b;
  // Make the key while paid (Session B refuses new keys on the free plan), then drop to free:
  // the key of a free account stays listed but stops working.
  await setPlan(user.id, "starter");
  await signIn(page, user);
  const key = await createKey(page, "E2E free");
  await setPlan(user.id, "free");

  const refused = await mcp(page, key, "initialize", initialize);
  expect(refused.status).toBe(403);
  expect(refused.body.error).toEqual({ code: -32003, message: "OpenCMO's MCP connection is part of the paid plans. Upgrade on the Credits page." });
  expect((await mcp(page, key, "tools/list")).status).toBe(403);
});
