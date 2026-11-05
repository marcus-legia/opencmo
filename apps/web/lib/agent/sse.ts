import { NextResponse } from "next/server";

import type { Emit } from "./loop";

/**
 * How often an idle stream sends a comment line. A long tool step (a render, a director call)
 * can send no event for minutes, and proxies drop a silent connection: streams over 2 minutes
 * died in production. Readers skip comment lines (no `event:`/`data:`).
 */
export const KEEP_ALIVE_MS = 15_000;

const KEEP_ALIVE = ": keep-alive\n\n";

/**
 * A Server-Sent Events response that runs `run` to the end. If the tab closes halfway, `run`
 * STILL finishes: the state lives in the database, and reopening the panel shows the result;
 * only nobody is listening to the events any more.
 */
export function sseResponse(run: (emit: Emit) => Promise<void>, keepAliveMs = KEEP_ALIVE_MS): NextResponse {
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    closed = true;
    clearInterval(timer);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const emit: Emit = (event, payload) => send(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      timer = setInterval(() => send(KEEP_ALIVE), keepAliveMs);
      void run(emit).finally(() => {
        if (closed) return;
        stop();
        controller.close();
      });
    },
    cancel() {
      stop();
    },
  });
  return new NextResponse(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" },
  });
}
