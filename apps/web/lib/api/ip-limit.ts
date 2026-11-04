/**
 * A per-IP fixed window held in this instance's memory, for the one public route that cannot use `rate_limit_hit()`:
 * that function requires a signed-in user. It only keeps log spam down; each instance counts on its own, so it must
 * never guard anything that costs money or moves data.
 */

const MAX_TRACKED_IPS = 5000;

type Window = { count: number; resetAt: number };

export function createIpLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, Window>();
  return function overLimit(ip: string, now = Date.now()): boolean {
    let current = windows.get(ip);
    if (!current || current.resetAt <= now) {
      // Spoofed addresses must not be able to grow this map without bound.
      if (windows.size >= MAX_TRACKED_IPS) windows.clear();
      current = { count: 0, resetAt: now + windowMs };
      windows.set(ip, current);
    }
    current.count += 1;
    return current.count > limit;
  };
}

/** Vercel sets `x-real-ip` itself; the forwarded chain's first entry is the fallback for other hosts and local runs. */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
