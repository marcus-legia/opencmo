/**
 * The Assistant's stream stays alive while a step is silent, and stops pinging once it ends.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/sse.check.ts
 */
import assert from "node:assert/strict";

import { sseResponse } from "./sse";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readAll(response: Response): Promise<string> {
  return await new Response(response.body).text();
}

async function main(): Promise<void> {
  // 1. A silent step: keep-alive comments flow, then the real event, then the stream closes.
  {
    const response = sseResponse(async (emit) => {
      await wait(60);
      emit("done", { ok: true });
    }, 10);
    const text = await readAll(response);
    assert.match(text, /^: keep-alive\n\n/, "a silent stream sends a comment line");
    assert.ok(text.endsWith('event: done\ndata: {"ok":true}\n\n'), "the event still arrives, last");
    // The readers' rule: a chunk without event/data is skipped.
    const events = text.split("\n\n").filter((chunk) => /^event: /m.test(chunk));
    assert.equal(events.length, 1);
  }
  // 2. After the run ends, no timer is left behind (the process would hang on it otherwise).
  {
    let pings = 0;
    const response = sseResponse(async () => undefined, 5);
    const reader = response.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (new TextDecoder().decode(value).startsWith(":")) pings++;
    }
    await wait(30);
    assert.equal(pings, 0, "a fast run sends no keep-alive and leaves no timer");
  }
  // 3. The tab goes away: cancelling stops the pings while the run keeps going.
  {
    let finished = false;
    const response = sseResponse(async () => {
      await wait(40);
      finished = true;
    }, 5);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await wait(60);
    assert.ok(finished, "the run finishes without a listener");
  }
  console.log("sse: ok");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
