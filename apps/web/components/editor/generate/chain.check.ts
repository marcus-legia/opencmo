/**
 * Regenerating a shot that others continue (/video) repoints them at its new hash, the same hash
 * the server computes, or they keep starting from the old shot's last frame.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { ClipDocument } from "@opencmo/clip-doc";
import { AI_MODELS } from "@opencmo/editor-core/generate";

import { normalizeSpec } from "@/lib/generate/create";
import { specHash } from "@/lib/generate/models";

import { continuationsOf, sha256, shotHash } from "./chain";
import { resolve, type Declaration } from "./useGenerations";

for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "tiếng Việt · 日本語 😀"]) {
  assert.equal(sha256(text), createHash("sha256").update(text).digest("hex"), `sha256 of ${text.length} chars`);
}

const model = AI_MODELS.find((item) => item.kind === "video" && item.id === "fake-video")!;
const server = (declaration: Declaration) => {
  const resolved = resolve(declaration);
  return specHash(resolved.model, normalizeSpec(model, resolved.spec));
};
const first = { generate: "video", model: model.id, prompt: "a laptop on a desk", aspectRatio: "9:16", duration: 5, seed: 1 } as Declaration;
assert.equal(shotHash(first), server(first), "the browser hash is the server's spec_hash");
const second = { ...first, prompt: "the screen lights up", seed: 2, after: server(first) } as Declaration;
const third = { ...first, prompt: "a hand taps the screen", seed: 3, after: server(second) } as Declaration;
const lone = { ...first, prompt: "a phone", seed: 4 } as Declaration;
const element = (id: string, src: Declaration) => ({ kind: "rect", id, width: 1080, height: 1920, paints: [{ type: "video", src }] });
const document = {
  version: 1,
  stage: { children: [{ kind: "scene", id: "sc", width: 1080, height: 1920, children: [element("a", first), element("b", second), element("c", third), element("d", lone)] }] },
} as unknown as ClipDocument;

const links = continuationsOf(document, "a", 99);
assert.deepEqual(links.map((link) => link.element_id), ["b", "c"], "the whole chain after the shot, in order");
const newFirst = { ...first, seed: 99 } as Declaration;
const newSecond = { ...second, after: server(newFirst) } as Declaration;
assert.equal(links[0]!.after, server(newFirst));
assert.equal(links[1]!.after, server(newSecond), "each link takes the new hash of the shot before it");
assert.deepEqual(continuationsOf(document, "b", 5).map((link) => link.element_id), ["c"], "from the middle of a chain");
assert.deepEqual(continuationsOf(document, "c", 5), [], "the last shot");
assert.deepEqual(continuationsOf(document, "d", 5), [], "a shot nothing continues");

console.log("chain.check: ok");
