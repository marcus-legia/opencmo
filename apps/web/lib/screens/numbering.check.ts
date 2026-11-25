/**
 *     cd apps/web && npx tsx lib/screens/numbering.check.ts
 */
import assert from "node:assert/strict";

import { numbersFromNewest, personNumbers, sourceIds, usedIn } from "./numbering";

// The reads come newest first: the newest scan is #1 (owner, 2026-11-25).
const scans = numbersFromNewest([{ id: "s3" }, { id: "s2" }, { id: "s1" }]);
assert.deepEqual([...scans], [["s3", 1], ["s2", 2], ["s1", 3]], "Scan #1 is the newest");

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
assert.equal(people.get("b"), "1.1", "best score first within a scan");
assert.equal(people.get("a"), "1.2");
assert.equal(people.get("c"), "3.1");
assert.ok(!people.has("d") && !people.has("e"), "no scan, no number");

const posts = [
  { id: "p2", created_at: "2026-11-25T08:00:00Z", sources: [{ opportunityId: "b" }, { opportunityId: "b" }] },
  { id: "p1", created_at: "2026-11-24T08:00:00Z", sources: [{ opportunityId: "b" }, { opportunityId: "c" }] },
  { id: "p3", created_at: "2026-11-26T08:00:00Z", sources: "not a list" },
];
const numbers = numbersFromNewest([posts[2]!, posts[0]!, posts[1]!]);
assert.deepEqual([...numbers], [["p3", 1], ["p2", 2], ["p1", 3]], "Post #1 is the newest");
const used = usedIn(posts, numbers);
assert.deepEqual(used.get("b"), [{ no: 2, id: "p2" }, { no: 3, id: "p1" }], "newest post first, once per post");
assert.deepEqual(used.get("c"), [{ no: 3, id: "p1" }]);
assert.deepEqual(sourceIds([{ opportunityId: 4 }, null, { opportunityId: "x" }]), ["x"]);
assert.deepEqual([...numbersFromNewest([{ id: "n" }, { id: "m" }])], [["n", 1], ["m", 2]], "the newest is #1 (owner, 2026-11-25)");
console.log("numbering: ok");
