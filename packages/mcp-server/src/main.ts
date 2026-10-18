/**
 * Starts the MCP server: `node dist/server.cjs` on Modal (`opencmo-mcp`, port 8000), or
 * `npm run dev` locally (tsx, port 8787).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { handle } from "./http";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

// A public server without its own URL would advertise the request's Host header as the OAuth
// resource (`oauth.ts`), which any caller can set. Refuse to start instead.
if (HOST === "0.0.0.0" && !process.env.OPENCMO_MCP_URL?.trim()) {
  console.error("[mcp] OPENCMO_MCP_URL is not set: a public server needs its own URL. Not starting.");
  process.exit(1);
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const url = `http://${req.headers.host ?? `${HOST}:${PORT}`}${req.url ?? "/"}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) return void res.end();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
  res.end();
}

const server = createServer((req, res) => {
  handle(toRequest(req))
    .then((response) => send(response, res))
    .catch((err) => {
      console.error("[mcp] request failed", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Something went wrong. Please try again." }));
    });
});
// Modal cuts web requests at 150 s; tools stay well under it (slow work is async).
server.requestTimeout = 140_000;
server.listen(PORT, HOST, () => console.log(`[mcp] listening on http://${HOST}:${PORT}/mcp`));
