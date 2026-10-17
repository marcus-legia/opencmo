/**
 * Where to send the browser after sign-in. `next` comes from the user's query (`/login?next=…`
 * goes straight into OAuth's `redirectTo`), so it is untrusted.
 *
 * Comparing origins alone is not enough: `new URL("/.//evil.example", base)` stays on the base
 * origin but normalizes to the path `//evil.example`, and a `Location: //evil.example` header is a
 * protocol-relative URL to another site. So the normalized path (decoded once, as a browser would)
 * must not start with `//` or `/\` either. Anything else unsafe falls back to `/app`.
 */

/** A fixed parse base, never sent to the browser; not the request's origin, which can be wrong. */
const PARSE_BASE = "http://redirect.invalid";

export function safeNext(next: string | null | undefined): string {
  if (!next) return "/app";
  let target: URL;
  let path: string;
  try {
    target = new URL(next, PARSE_BASE);
    path = decodeURIComponent(target.pathname);
  } catch {
    return "/app";
  }
  if (target.origin !== PARSE_BASE || path.startsWith("//") || path.startsWith("/\\")) return "/app";
  return `${target.pathname}${target.search}`;
}
