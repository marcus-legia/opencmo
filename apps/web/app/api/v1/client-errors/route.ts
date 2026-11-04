import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { withApi, type RouteContext } from "@/lib/api/handler";
import { clientIp, createIpLimiter } from "@/lib/api/ip-limit";
import { logEvent } from "@/lib/log";

const Body = z.object({
  kind: z.enum(["error", "unhandledrejection", "boundary", "global-boundary", "reported"]),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(500),
  source: z.string().max(200).optional(),
  digest: z.string().max(100).optional(),
});

const overLimit = createIpLimiter(30, 60_000);

// Public, because the landing and login pages can break for people who are not signed in. Same-origin writes only
// (`withApi`), and all it can do is add a capped line to the log.
const report = withApi({ auth: false, body: Body, maxBodyBytes: 16 * 1024 }, async ({ body, supabase, request }) => {
  const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  logEvent("error", "client_error", {
    ...body,
    user: data.user?.id,
    userAgent: request.headers.get("user-agent")?.slice(0, 300),
  });
  return new NextResponse(null, { status: 204 });
});

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  // Ahead of `withApi`, which logs refused requests: a flood must not turn into log lines by another route.
  if (overLimit(clientIp(request.headers))) return new NextResponse(null, { status: 429 });
  return report(request, context);
}
