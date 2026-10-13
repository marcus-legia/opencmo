/**
 * Removing a generated file from the library also removes the elements that declare it: a
 * declaration left without its library record is sent again, a new paid generation nobody approved.
 */
import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

import { elementsForGeneration, resolve } from "./useGenerations";

const shot = { generate: "video", prompt: "a laptop on a desk", aspectRatio: "9:16", duration: 5, seed: 7 };
const other = { generate: "image", prompt: "a coffee cup", aspectRatio: "9:16", seed: 1 };
const document = {
  version: 1,
  stage: {
    children: [
      {
        kind: "scene",
        id: "sc",
        width: 1080,
        height: 1920,
        children: [
          { kind: "video", id: "speaker", src: "assets/master.mp4" },
          { kind: "video", id: "broll", src: shot, start: 2, end: 5 },
          { kind: "rect", id: "card", width: 100, height: 100, paints: [{ type: "image", src: shot }] },
          { kind: "group", id: "g", children: [{ kind: "image", id: "cup", src: other }] },
        ],
      },
    ],
  },
} as unknown as ClipDocument;

const key = (declaration: Record<string, unknown>) => JSON.stringify(resolve(declaration as never));

assert.deepEqual(elementsForGeneration(document, key(shot)), ["broll", "card"], "every element using the shot, as a source or a paint");
assert.deepEqual(elementsForGeneration(document, key(other)), ["cup"], "inside a group too");
assert.deepEqual(elementsForGeneration(document, key({ ...shot, seed: 8 })), [], "another seed is another generation");

console.log("generations.check: ok");
