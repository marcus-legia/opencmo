/**
 * Runs for real:
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/clipping/create.check.ts
 *
 * The first of the three manual-only gates (plan item 1): the body both clip routes parse.
 * `create_job()` (pgTAP 184) and the worker refuse the same request again.
 */
import assert from "node:assert/strict";

import { createClipJobInput } from "./create";

const link = { source: "https://youtu.be/abc", ownership_confirmed: true };
const message = (body: unknown) => {
  const parsed = createClipJobInput.safeParse(body);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

assert.equal(message(link), "Pick at least one moment to clip.");
assert.equal(message({ ...link, segments: [] }), "Pick at least one moment to clip.");
assert.equal(message({ ...link, clips: 5, clip_length: "long" }), "Pick at least one moment to clip.");
assert.equal(message({ ...link, segments: [{ start: 10, end: 40 }] }), null);
// The whole video into the editor needs no moments.
assert.equal(message({ source: "storage://media/u/a.mp4", mode: "full" }), null);

console.log("create.check: ok");
