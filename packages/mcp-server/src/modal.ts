/**
 * `callModal` / `spawnModal` of the tool context: functions of our Modal app (`opencmo`) called
 * through Modal's own client, with no HTTP hop. The MCP container runs inside that app; the client
 * signs in with `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` (the `opencmo-mcp` secret).
 *
 * Today's tools do not need it: renders go through the task queue (`generations` → `run_task`)
 * and previews through `motion_preview`, exactly as in the app. It is the path for tools that
 * call a function directly.
 */

import type { ModalClient } from "modal";

const APP = process.env.OPENCMO_MODAL_APP ?? "opencmo";

/** Functions a tool may call: never `run_job`/`submit` (they trust the caller) or the crons. */
const ALLOWED = new Set(["render_motion", "render_three", "run_task"]);

let client: Promise<ModalClient> | null = null;

function modal(): Promise<ModalClient> {
  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
    return Promise.reject(new Error("This server is not connected to Modal (MODAL_TOKEN_ID / MODAL_TOKEN_SECRET)."));
  }
  client ??= import("modal").then(({ ModalClient }) => new ModalClient());
  return client;
}

async function lookup(fn: string) {
  if (!ALLOWED.has(fn)) throw new Error(`Modal function "${fn}" is not callable from MCP tools.`);
  return (await modal()).functions.fromName(APP, fn);
}

/** One positional argument, or an array for several (`run_task(task_id, attempt_id)`). */
const args = (payload: unknown): unknown[] => (Array.isArray(payload) ? payload : [payload]);

export async function callModal<T>(fn: string, payload: unknown): Promise<T> {
  return (await (await lookup(fn)).remote(args(payload))) as T;
}

export async function spawnModal(fn: string, payload: unknown): Promise<string> {
  return (await (await lookup(fn)).spawn(args(payload))).functionCallId;
}
