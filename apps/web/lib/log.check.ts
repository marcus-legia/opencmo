/** `tsx lib/log.check.ts`: what a log line may contain, and the limiter on the public route that writes them. */
import assert from "node:assert/strict";

import { clientIp, createIpLimiter } from "./api/ip-limit";
import { isNoise } from "./client-errors";
import { LOG_TAG, errorFields, logEvent } from "./log";

const lines: string[] = [];
const realError = console.error;
const realWarn = console.warn;
console.error = (line: string) => lines.push(`error ${line}`);
console.warn = (line: string) => lines.push(`warn ${line}`);

logEvent("error", "forged", { message: 'one\n{"tag":"opencmo_log","event":"fake"}', long: "x".repeat(10_000), gone: undefined });
logEvent("warn", "urls", {
  signed: "failed https://x.supabase.co/object/a.mp4?token=SECRET#frag at line",
  callback: "https://opencmo.io/auth/callback#access_token=SECRET",
  question: "are you sure? yes",
  status: 500,
});

console.error = realError;
console.warn = realWarn;

assert.equal(lines.length, 2);
assert.ok(lines[0]!.startsWith("error "));
assert.ok(lines[1]!.startsWith("warn "));
assert.ok(!lines[0]!.includes("\n"), "a newline in a field must not start a second log line");
const forged = JSON.parse(lines[0]!.slice("error ".length));
assert.equal(forged.tag, LOG_TAG);
assert.equal(forged.long.length, 4000);
assert.ok(!("gone" in forged));

assert.ok(!lines[1]!.includes("SECRET"), "query strings and fragments stay out of the log");
const urls = JSON.parse(lines[1]!.slice("warn ".length));
assert.equal(urls.signed, "failed https://x.supabase.co/object/a.mp4 at line");
assert.equal(urls.question, "are you sure? yes");
assert.equal(urls.status, 500);

assert.equal(errorFields(new TypeError("boom")).error, "TypeError: boom");
assert.equal(errorFields({ message: "postgrest" }).error, "postgrest");
assert.equal(errorFields("text").error, "text");

assert.ok(isNoise({ name: "AbortError", message: "aborted" }));
assert.ok(isNoise({ message: "ResizeObserver loop completed with undelivered notifications." }));
assert.ok(isNoise({ message: "x", stack: "at chrome-extension://abc/content.js:1:1" }));
assert.ok(!isNoise({ name: "TypeError", message: "x is not a function", stack: "at https://opencmo.io/_next/a.js:1:1" }));

const over = createIpLimiter(2, 1000);
assert.equal(over("a", 0), false);
assert.equal(over("a", 1), false);
assert.equal(over("a", 2), true);
assert.equal(over("b", 2), false, "each address counts on its own");
assert.equal(over("a", 1001), false, "the window resets");

assert.equal(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })), "1.1.1.1");
assert.equal(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "2.2.2.2");
assert.equal(clientIp(new Headers()), "unknown");

console.log("log: all checks green");
