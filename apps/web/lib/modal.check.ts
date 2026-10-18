import assert from "node:assert/strict";

import { wakeWorker } from "./modal";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.MODAL_SUBMIT_URL;
const originalToken = process.env.OPENCMO_WORKER_TOKEN;
const originalWakeUrl = process.env.OPENCMO_WAKE_URL;
const originalWakeToken = process.env.OPENCMO_WAKE_TOKEN;

let calledUrl = "";

async function capturePayload(run: () => Promise<boolean>): Promise<unknown> {
  let payload: unknown;
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    payload = JSON.parse(String(init?.body));
    return new Response(null, { status: 202 });
  };

  assert.equal(await run(), true);
  return payload;
}

async function main(): Promise<void> {
  process.env.MODAL_SUBMIT_URL = "https://worker.example/submit";
  process.env.OPENCMO_WORKER_TOKEN = "test-token";

  const taskPayload = await capturePayload(() => wakeWorker({ task_id: "task-1" }));
  assert.deepEqual(taskPayload, { token: "test-token", task_id: "task-1" });

  const jobPayload = await capturePayload(() =>
    wakeWorker({
      id: "job-1",
      user_id: "user-1",
      source_url: "https://youtu.be/example",
      clips_requested: 3,
      watermark: false,
    }),
  );
  assert.deepEqual(jobPayload, { token: "test-token", job_id: "job-1" });

  // The MCP server holds only the wake token: the worker token never leaves its body.
  process.env.OPENCMO_WAKE_URL = "https://worker.example/wake";
  process.env.OPENCMO_WAKE_TOKEN = "wake-token";
  assert.deepEqual(await capturePayload(() => wakeWorker({ task_id: "task-2" })), { token: "test-token", task_id: "task-2" }, "submit wins when the worker token is here");
  delete process.env.OPENCMO_WORKER_TOKEN;
  assert.deepEqual(await capturePayload(() => wakeWorker({ task_id: "task-3" })), { token: "wake-token" }, "wake carries no job or task id");
  assert.equal(calledUrl, "https://worker.example/wake");
  delete process.env.OPENCMO_WAKE_TOKEN;
  assert.equal(await wakeWorker({ task_id: "task-4" }), false, "no token at all: leave it to sweep()");

  console.log("Modal submit contract: job_id and task_id payloads are valid; wake carries only its token.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.MODAL_SUBMIT_URL;
    else process.env.MODAL_SUBMIT_URL = originalUrl;
    if (originalToken === undefined) delete process.env.OPENCMO_WORKER_TOKEN;
    else process.env.OPENCMO_WORKER_TOKEN = originalToken;
    if (originalWakeUrl === undefined) delete process.env.OPENCMO_WAKE_URL;
    else process.env.OPENCMO_WAKE_URL = originalWakeUrl;
    if (originalWakeToken === undefined) delete process.env.OPENCMO_WAKE_TOKEN;
    else process.env.OPENCMO_WAKE_TOKEN = originalWakeToken;
  });
