import { validate, type ClipDocument } from "@opencmo/clip-doc";
import { describe, expect, it } from "vitest";

import { cutPoints, readCaptionState, speechSources } from "./captions";
import { byId, nodes, sceneOf } from "./doc";
import { OpError, applyOps, type OpContext } from "./ops";
import { normalize, type Transcript } from "./transcript";

const TALK = `assets/transcripts/${"a".repeat(64)}.json`;
const MASTER_TRANSCRIPT: Transcript = [
  { text: "so this is the thing", words: [{ text: "so", start: 2.1, end: 2.3 }, { text: "this", start: 2.35, end: 2.6 }, { text: "thing", start: 3.75, end: 4.2 }] },
];
/** A recording in FILE seconds: "hello um world … again". */
const TALK_TRANSCRIPT: Transcript = [
  { text: "hello um world", words: [{ text: "hello", start: 0.5, end: 0.9 }, { text: "um", start: 1.0, end: 1.4 }, { text: "world", start: 1.6, end: 2.0 }] },
  { text: "again", words: [{ text: "again", start: 8, end: 8.5 }] },
];
const talkIds = normalize(TALK_TRANSCRIPT).flatMap((segment) => segment.words.map((word) => word.id!));
const masterIds = normalize(MASTER_TRANSCRIPT).flatMap((segment) => segment.words.map((word) => word.id!));

function memoryContext(): OpContext {
  const files = new Map<string, Transcript>([
    ["assets/transcript.json", MASTER_TRANSCRIPT],
    [TALK, TALK_TRANSCRIPT],
  ]);
  return {
    master: { width: 1920, height: 1080 },
    readTranscript: async (path) => {
      const found = files.get(path);
      if (!found) throw new Error(`missing ${path}`);
      return structuredClone(found);
    },
    saveTranscript: async (transcript) => {
      const path = `assets/transcripts/${String(files.size).padStart(64, "0")}.json`;
      files.set(path, structuredClone(transcript));
      return path;
    },
  };
}

/** A library video as the editor places it (`nodeFor`): a rect painted with the file, in a row. */
const talkRect = (start: number, end: number) => ({
  kind: "rect",
  id: "talk",
  name: "talk",
  x: 0,
  y: 0,
  width: 1080,
  height: 1920,
  keepAspectRatio: true,
  start,
  end,
  paints: [{ type: "video", src: "uploads/talk.mp4" }],
});

const talkCaptions = (start: number, end: number) => ({ kind: "captions", id: "talkcap", src: TALK, source: "talk", hidden: true, start, end });

/** A master clip with a second recording (5–25 s) linked to its own transcript. */
const MASTER_CLIP: ClipDocument = {
  version: 1,
  stage: {
    children: [
      {
        kind: "scene",
        id: "scene",
        width: 1080,
        height: 1920,
        workarea: [0, 30],
        children: [
          { kind: "video", id: "master", src: "assets/master.mp4", width: 1080, height: 1920, start: 0, sourceIn: 2, sourceOut: 32 },
          { kind: "sequence", id: "row", name: "B-roll 1", children: [talkRect(5, 25)] },
          { kind: "captions", id: "mastercap", src: "assets/transcript.json", start: 0, sourceIn: 2, sourceOut: 32 },
          talkCaptions(5, 25),
        ],
      },
    ],
  },
} as unknown as ClipDocument;

/** A blank New edit: the recording at 2–12 s, a title before it and a card after it. */
const BLANK_EDIT: ClipDocument = {
  version: 1,
  stage: {
    children: [
      {
        kind: "scene",
        id: "scene",
        width: 1080,
        height: 1920,
        workarea: [0, 14],
        children: [
          { kind: "text", id: "title", text: "Hi", start: 0, end: 2 },
          talkRect(2, 12),
          { kind: "text", id: "card", text: "Bye", start: 12, end: 14 },
          talkCaptions(2, 12),
        ],
      },
    ],
  },
} as unknown as ClipDocument;

const node = (document: ClipDocument, id: string) => byId(document, id)?.entity as Record<string, unknown> | undefined;
const masterVideo = (document: ClipDocument) => nodes(document).find((item) => item.kind === "video") as unknown as Record<string, unknown>;

describe("speech sources", () => {
  it("lists the master first, then each linked video", () => {
    expect(speechSources(MASTER_CLIP)).toEqual([
      { elementId: "master", name: "Main video", captionsId: "mastercap", transcript: "assets/transcript.json", window: { start: 2, end: 32 }, master: true },
      { elementId: "talk", name: "talk", captionsId: "talkcap", transcript: TALK, window: { start: 0, end: 20 }, master: false },
    ]);
  });

  it("cuts the second video by words and leaves the master alone", async () => {
    const before = masterVideo(MASTER_CLIP);
    const { document, results } = await applyOps(MASTER_CLIP, [{ op: "remove_words", element_id: "talk", word_ids: [talkIds[1]!] }], memoryContext());
    expect(results).toEqual([{ op: "remove_words", summary: "Remove 1 word from the video", changed: true }]);
    expect(masterVideo(document)).toEqual(before);
    expect(readCaptionState(document)!.removed).toEqual([]);
    expect(node(document, "mastercap")).toEqual(node(MASTER_CLIP, "mastercap"));

    const cut = node(document, "talk")!;
    expect(cut.kind).toBe("sequence");
    const segments = cut.children as Record<string, unknown>[];
    expect(segments.map((segment) => [segment.kind, segment.start, segment.end, segment.sourceIn, segment.sourceOut])).toEqual([
      ["rect", 5, 5.97, 0, 0.97],
      ["rect", 5.97, 24.54, 1.43, 20],
    ]);
    // Still in its row, and the timeline around it does not move in a master clip.
    expect((node(document, "row")!.children as unknown[])[0]).toBe(cut);
    expect(sceneOf(document)!.workarea).toEqual([0, 30]);
    // Its captions read the cut transcript from where the video starts.
    expect(node(document, "talkcap")).toMatchObject({ source: "talk", hidden: true, start: 5, end: 24.54, sourceIn: 0, sourceOut: 19.54 });
    expect(readCaptionState(document, "talk")!.removed).toEqual([{ start: 0.97, end: 1.43 }]);
    expect(cutPoints(document, "talk")).toEqual([{ at: 5.97, roll: 0 }]);
    expect(() => validate(document)).not.toThrow();
  });

  it("keeps the element id through cut, re-cut and restore", async () => {
    const ctx = memoryContext();
    const once = await applyOps(MASTER_CLIP, [{ op: "remove_words", element_id: "talk", word_ids: [talkIds[1]!] }], ctx);
    // A segment's id names its cut, as the selected element in the Transcript panel does.
    const segment = (node(once.document, "talk")!.children as { id: string }[])[1]!.id;
    const twice = await applyOps(once.document, [{ op: "remove_words", element_id: segment, word_ids: [talkIds[3]!] }], ctx);
    expect(node(twice.document, "talk")!.kind).toBe("sequence");
    expect(readCaptionState(twice.document, "talk")!.removed).toHaveLength(2);
    const restored = await applyOps(twice.document, [{ op: "restore_all", element_id: "talk" }], ctx);
    expect(node(restored.document, "talk")).toMatchObject({ kind: "rect", start: 5, end: 25, sourceIn: 0, sourceOut: 20 });
    expect(node(restored.document, "talkcap")).toMatchObject({ src: TALK, start: 5, end: 25, sourceIn: 0, sourceOut: 20 });
  });

  it("without element_id still cuts the master; the linked video's captions follow it", async () => {
    const { document } = await applyOps(MASTER_CLIP, [{ op: "remove_words", word_ids: [masterIds[1]!] }], memoryContext());
    expect(readCaptionState(document)!.removed).toHaveLength(1);
    // B-roll follows the words over it, as before; its transcript layer stays on it.
    const talk = node(document, "talk")!;
    expect(talk.kind).toBe("rect");
    expect(talk.start).toBeLessThan(5);
    expect(node(document, "talkcap")).toMatchObject({ start: talk.start, end: talk.end });
  });

  it("names the videos when there are several and no id", async () => {
    const two = structuredClone(BLANK_EDIT);
    const scene = two.stage.children[0] as unknown as { children: Record<string, unknown>[] };
    scene.children.push({ ...talkRect(14, 20), id: "second", name: "second take" }, { ...talkCaptions(14, 20), id: "secondcap", source: "second" });
    const failed = applyOps(two, [{ op: "remove_words", word_ids: [talkIds[1]!] }], memoryContext());
    await expect(failed).rejects.toBeInstanceOf(OpError);
    await expect(failed).rejects.toThrow("This clip has several videos with speech: pass element_id (talk: talk, second take: second).");
    await expect(applyOps(two, [{ op: "remove_words", element_id: "nope", word_ids: [talkIds[1]!] }], memoryContext())).rejects.toThrow('No video with id "nope"');
    // Reading without an id is not an error: the summary just has no default source.
    expect(readCaptionState(two)).toBeNull();
  });

  it("in a blank edit the recording is the spine: what comes after it moves with the cut", async () => {
    const { document } = await applyOps(BLANK_EDIT, [{ op: "remove_words", word_ids: [talkIds[1]!] }], memoryContext());
    expect(node(document, "title")).toMatchObject({ start: 0, end: 2 });
    expect(node(document, "card")).toMatchObject({ start: 11.54, end: 13.54 });
    expect(sceneOf(document)!.workarea).toEqual([0, 13.54]);
    expect(node(document, "talkcap")).toMatchObject({ start: 2, end: 11.54 });
    const restored = await applyOps(document, [{ op: "restore_all" }], memoryContext());
    expect(node(restored.document, "card")).toMatchObject({ start: 12, end: 14 });
    expect(sceneOf(restored.document)!.workarea).toEqual([0, 14]);
  });
});

describe("attach_transcript", () => {
  const unlinked = () => {
    const document = structuredClone(MASTER_CLIP);
    const scene = document.stage.children[0] as unknown as { children: Record<string, unknown>[] };
    scene.children = scene.children.filter((item) => item.id !== "talkcap");
    return document;
  };

  it("adds a hidden captions layer linked to the video and timed like it, in the scene", async () => {
    const { document, results } = await applyOps(unlinked(), [{ op: "attach_transcript", element_id: "talk", src: TALK }], memoryContext());
    expect(results).toEqual([{ op: "attach_transcript", summary: "Attach transcript", changed: true }]);
    const captions = nodes(document).find((item) => item.kind === "captions" && (item as { source?: string }).source === "talk") as Record<string, unknown>;
    expect(captions).toMatchObject({ kind: "captions", name: "Transcript · talk", src: TALK, source: "talk", hidden: true, start: 5, end: 25 });
    expect((sceneOf(document)!.children as unknown[]).includes(captions)).toBe(true);
    expect(speechSources(document).map((source) => source.elementId)).toEqual(["master", "talk"]);
  });

  it("attaching twice is a no-op", async () => {
    const once = await applyOps(unlinked(), [{ op: "attach_transcript", element_id: "talk", src: TALK }], memoryContext());
    const twice = await applyOps(once.document, [{ op: "attach_transcript", element_id: "talk", src: TALK }], memoryContext());
    expect(twice.results[0]!.changed).toBe(false);
    expect(twice.document).toEqual(once.document);
  });

  it("refuses what is not a video, and the agent cannot call it", async () => {
    await expect(applyOps(unlinked(), [{ op: "attach_transcript", element_id: "row", src: TALK }], memoryContext())).rejects.toThrow('No video with id "row"');
    const { AGENT_OP_INPUTS } = await import("./ops");
    expect(AGENT_OP_INPUTS.attach_transcript).toBeUndefined();
  });
});
