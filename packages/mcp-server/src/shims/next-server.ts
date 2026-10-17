/**
 * `next/server` in the Modal bundle. The tools are web-app modules; a few import Next for code
 * paths a route handler uses (`NextResponse`) or for `after()` (the CMO runner's kick). The MCP
 * server never answers through Next, so these stand-ins keep the imports working without Next.
 */

/** Runs the task after the current one without blocking it, as `after()` does in a route. */
export function after(task: Promise<unknown> | (() => unknown)): void {
  void Promise.resolve()
    .then(() => (typeof task === "function" ? task() : task))
    .catch((err: unknown) => console.error("[mcp] after() task failed", err));
}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) } });
  }
}

export type NextRequest = Request;
export const NextRequest = Request;
