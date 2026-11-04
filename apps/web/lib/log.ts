/**
 * One JSON line per event, searchable in Vercel's logs by `LOG_TAG` (`npm run qa:logs` pulls them before Vercel's
 * retention drops them). No imports, so the API handler, instrumentation and the `.check.ts` scripts can all use it.
 *
 * Fields can hold text a browser sent us, so the line is what keeps it harmless: JSON escapes newlines (no forged log
 * lines), each field has a length cap, and URLs lose their query and fragment, where signed-URL tokens and auth codes
 * live. Never pass prompts, documents or secrets as fields.
 */

export const LOG_TAG = "opencmo_log";

const MAX_FIELD_CHARS = 4000;
const URL_SECRETS = /(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g;

function clean(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.replace(URL_SECRETS, "$1").slice(0, MAX_FIELD_CHARS);
}

export function logEvent(level: "error" | "warn", event: string, fields: Record<string, unknown> = {}): void {
  const line: Record<string, unknown> = { tag: LOG_TAG, event };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) line[key] = clean(value);
  }
  (level === "error" ? console.error : console.warn)(JSON.stringify(line));
}

/** The parts of a thrown value worth keeping; `JSON.stringify(new Error())` is `{}`. */
export function errorFields(error: unknown): { error: string; stack?: string } {
  if (error instanceof Error) return { error: `${error.name}: ${error.message}`, stack: error.stack };
  if (error && typeof error === "object" && "message" in error) return { error: String(error.message) };
  return { error: String(error) };
}
