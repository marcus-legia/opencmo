/**
 * Sends browser errors to `/api/v1/client-errors`, which writes them to the server log. Without this an error in the
 * editor is only ever seen in the console of the person who hit it. Reporting must never cause a second failure, so
 * nothing here throws.
 */

export type ClientErrorKind = "error" | "unhandledrejection" | "boundary" | "global-boundary" | "reported";

export const CLIENT_ERRORS_PATH = "/api/v1/client-errors";

const MAX_REPORTS_PER_PAGE = 20;
const EXTENSION_SOURCE = /(chrome|moz|safari-web)-extension:\/\//;

let sent = 0;
const seen = new Set<string>();

function describe(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  if (error && typeof error === "object" && "message" in error) return { message: String(error.message) };
  return { message: String(error) };
}

/** Noise that says nothing about our code: cancelled requests, the browser's ResizeObserver notice, extensions. */
export function isNoise(error: { name?: string; message: string; stack?: string; filename?: string }): boolean {
  if (error.name === "AbortError") return true;
  if (error.message === "Script error." || error.message.startsWith("ResizeObserver loop")) return true;
  return EXTENSION_SOURCE.test(error.filename ?? "") || EXTENSION_SOURCE.test(error.stack ?? "");
}

export function reportClientError(
  kind: ClientErrorKind,
  error: unknown,
  extra: { source?: string; digest?: string; filename?: string } = {},
): void {
  try {
    const described = describe(error);
    if (isNoise({ ...described, filename: extra.filename })) return;

    // A render error repeats every frame: one report per distinct error, and a ceiling per page.
    const key = `${kind}|${extra.source ?? ""}|${described.message}`;
    if (seen.has(key) || sent >= MAX_REPORTS_PER_PAGE) return;
    seen.add(key);
    sent += 1;

    const body = JSON.stringify({
      kind,
      message: described.name ? `${described.name}: ${described.message}`.slice(0, 2000) : described.message.slice(0, 2000),
      stack: described.stack?.slice(0, 8000),
      // The path only: a query string can carry auth codes.
      path: window.location.pathname.slice(0, 500),
      source: extra.source?.slice(0, 200),
      digest: extra.digest?.slice(0, 100),
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.(CLIENT_ERRORS_PATH, blob)) {
      void fetch(CLIENT_ERRORS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // See the top of this file.
  }
}
