/**
 *     cd apps/web && npx tsx lib/screens/numbering.check.ts
 */
import assert from "node:assert/strict";

import { numbersFromNewest, personNumbers, postNumbers, scanNumbers, sourceIds, usedIn } from "./numbering";

const scans = scanNumbers([
  { id: "s2", created_at: "2026-11-24T10:00:00Z" },
  { id: "s1", created_at: "2026-11-23T10:00:00Z" },
  { id: "s3", created_at: "2026-11-25T10:00:00Z" },
]);
assert.deepEqual([...scans], [["s1", 1], ["s2", 2], ["s3", 3]], "Scan #1 is the oldest");

const people = personNumbers(
  [
    { id: "a", run_id: "s3", score: 62, created_at: "2026-11-25T10:01:00Z" },
    { id: "b", run_id: "s3", score: 80, created_at: "2026-11-25T10:01:00Z" },
    { id: "c", run_id: "s1", score: 70, created_at: "2026-11-23T10:01:00Z" },
    { id: "d", run_id: null, score: 90, created_at: "2026-11-23T10:01:00Z" },
    { id: "e", run_id: "gone", score: 90, created_at: "2026-11-23T10:01:00Z" },
  ],
  scans,
);
assert.equal(people.get("b"), "3.1", "best score first within a scan");
assert.equal(people.get("a"), "3.2");
assert.equal(people.get("c"), "1.1");
assert.ok(!people.has("d") && !people.has("e"), "no scan, no number");

const posts = [
  { id: "p2", created_at: "2026-11-25T08:00:00Z", sources: [{ opportunityId: "b" }, { opportunityId: "b" }] },
  { id: "p1", created_at: "2026-11-24T08:00:00Z", sources: [{ opportunityId: "b" }, { opportunityId: "c" }] },
  { id: "p3", created_at: "2026-11-26T08:00:00Z", sources: "not a list" },
];
const numbers = postNumbers(posts);
assert.deepEqual([...numbers], [["p1", 1], ["p2", 2], ["p3", 3]], "Post #1 is the oldest");
const used = usedIn(posts, numbers);
assert.deepEqual(used.get("b"), [{ no: 2, id: "p2" }, { no: 1, id: "p1" }], "newest post first, once per post");
assert.deepEqual(used.get("c"), [{ no: 1, id: "p1" }]);
assert.deepEqual(sourceIds([{ opportunityId: 4 }, null, { opportunityId: "x" }]), ["x"]);
assert.deepEqual([...numbersFromNewest([{ id: "n" }, { id: "m" }], 2100)], [["n", 2100], ["m", 2099]], "a page of the newest rows keeps their real numbers");
assert.deepEqual([...numbersFromNewest([{ id: "n" }], 0)], [["n", 1]], "a missing count still numbers the page");
console.log("numbering: ok");
