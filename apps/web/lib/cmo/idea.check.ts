/**
 * Reply ideas on screen: Idea and Solution with the words to say under each, and old unlabelled ideas still readable.
 */
import assert from "node:assert/strict";

import { ownShare, OWN_ENOUGH, parseIdea } from "@/lib/cmo/idea";

{
  const parts = parseIdea(
    [
      "Idea: Free users rarely become customers. Ask who pays first.",
      '"My first ten came from asking who pays for a tool like this today."',
      "**Solution:** Find people already asking for it.",
      "“Search your niche for the exact complaint and reply there.”",
    ].join("\n"),
  );
  assert.deepEqual(parts.map((p) => p.kind), ["idea", "solution"]);
  assert.equal(parts[0]!.text, "Free users rarely become customers. Ask who pays first.");
  assert.deepEqual(parts[0]!.say, ["My first ten came from asking who pays for a tool like this today."]);
  assert.equal(parts[1]!.text, "Find people already asking for it.");
  assert.deepEqual(parts[1]!.say, ["Search your niche for the exact complaint and reply there."]);
}

// An idea from before the labels: first line is the idea, the rest is said; "Solution" still shows, empty.
{
  const parts = parseIdea("Start with direct contact.\nCall ten practices and ask how they book.");
  assert.deepEqual(parts.map((p) => p.kind), ["idea", "solution"]);
  assert.equal(parts[0]!.text, "Start with direct contact.");
  assert.deepEqual(parts[0]!.say, ["Call ten practices and ask how they book."]);
  assert.equal(parts[1]!.text, "");
}

assert.deepEqual(parseIdea(""), []);

// Copying the idea back is not "your words"; a reply in the founder's own words is.
{
  const idea = "Idea: Ask who pays first.\n\"My first ten came from asking who pays.\"";
  assert.equal(ownShare("", idea), 0);
  assert.ok(ownShare("My first ten came from asking who pays", idea) < OWN_ENOUGH);
  assert.ok(ownShare("When we launched our invoicing tool, the first buyers were two agencies I already knew from meetups", idea) >= OWN_ENOUGH);
}

console.log("idea ok");
