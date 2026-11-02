/**
 * Links in posts and captions (review follow-up Q8): `hasLink` and SQL `caption_check` agree on the shared cases in
 * `packages/contracts/link-cases.json`, and pgTAP 244 tests the same strings.
 *
 *     tsx lib/cmo/jobs/check-post.check.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { hasLink } from "./check-post";

const cases = JSON.parse(readFileSync(new URL("../../../../../packages/contracts/link-cases.json", import.meta.url), "utf8")) as { refused: string[]; allowed: string[] };
const pgtap = readFileSync(new URL("../../../../../supabase/tests/244_review_followups.test.sql", import.meta.url), "utf8");

for (const text of cases.refused) assert.ok(hasLink(text), `a link: ${text}`);
for (const text of cases.allowed) assert.ok(!hasLink(text), `not a link: ${text}`);
for (const text of [...cases.refused, ...cases.allowed]) assert.ok(pgtap.includes(text.replace(/'/g, "''")), `pgTAP 244 tests "${text}" too`);

console.log("check-post.check ok");
