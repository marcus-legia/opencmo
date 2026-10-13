import { MAX_DOCUMENT_BYTES, storedBytes, type ClipDocument } from "@opencmo/clip-doc";
import { describe, expect, it } from "vitest";

import { nodes } from "./doc";
import { faceXTrack } from "./face-track";
import { applyOps, type OpContext } from "./ops";
import { xForFocus } from "./reframe";
import type { Transcript } from "./transcript";

const BOX = 3413.33;
const FRAME = 1080;
const round = (value: number) => Math.round(value * 1000) / 1000;
const xFor = (focus: number) => round(Math.min(0, Math.max(FRAME - BOX, FRAME / 2 - focus * BOX)));

/** A `full` clip as generated: 9:16, face-tracked over `minutes`, six words then a pause every 5 s. */
function longClip(minutes: number): { document: ClipDocument; context: OpContext } {
  const end = minutes * 60;
  const step = Math.max(2, end / 40);
  const track: [number, number][] = [];
  for (let index = 0; index * step <= end + 1e-6; index++) track.push([round(index * step), index % 2 ? 0.7 : 0.3]);
  const transcript: Transcript = [];
  for (let t = 0; t < end - 5; t += 5) {
    const words = Array.from({ length: 6 }, (_, i) => ({ text: `w${i}`, start: round(t + i * 0.6), end: round(t + i * 0.6 + 0.5) }));
    transcript.push({ text: words.map((word) => word.text).join(" "), words });
  }
  const document = {
    version: 1,
    stage: {
      background: "#000000",
      children: [
        {
          kind: "scene",
          name: "Clip",
          width: FRAME,
          height: 1920,
          fill: "#000000",
          active: true,
          workarea: [0, end],
          marks: { reframe: { focus: 0.5, track, mode: "fill" } },
          children: [
            {
              kind: "video",
              src: "assets/master.mp4",
              x: xFor(track[0]![1]),
              y: 0,
              width: BOX,
              height: 1920,
              objectFit: "cover",
              start: 0,
              sourceIn: 0,
              sourceOut: end,
              tracks: [{ property: "x", keyframes: track.map(([time, focus]) => ({ time, value: xFor(focus), easing: "easeInOut" })) }],
            },
            { kind: "captions", src: "assets/transcript.json", preset: "classic", verticalAlign: "bottom", start: 0, sourceIn: 0, sourceOut: end },
          ],
        },
      ],
    },
  } as unknown as ClipDocument;
  const files = new Map<string, Transcript>([["assets/transcript.json", transcript]]);
  const context: OpContext = {
    master: { width: 1920, height: 1080 },
    readTranscript: async (path) => {
      const found = files.get(path);
      if (!found) throw new Error(`missing ${path}`);
      return structuredClone(found);
    },
    saveTranscript: async (next) => {
      const path = `assets/transcripts/${String(files.size).padStart(64, "0")}.json`;
      files.set(path, structuredClone(next));
      return path;
    },
  };
  return { document, context };
}

const videos = (document: ClipDocument) => nodes(document).filter((node) => node.kind === "video");
const xKeys = (document: ClipDocument) =>
  videos(document).map((video) => ((video as { tracks?: { property: string; keyframes: unknown[] }[] }).tracks ?? []).find((track) => track.property === "x")?.keyframes.length ?? 0);

/** `[time, x]` of every video's x keys; x to the pixel (ids and sub-pixel rounding are not the point). */
const xTracks = (document: ClipDocument) =>
  videos(document).map((video) =>
    ((video as unknown as { tracks?: { property: string; keyframes: { time: number; value: number }[] }[] }).tracks ?? [])
      .filter((track) => track.property === "x")
      .flatMap((track) => track.keyframes.map((key) => [key.time, Math.round(key.value)])),
  );

const silence = { op: "remove_silence", min_pause: 0.25, padding: 0 };

const face = { track: [[0, 0.3], [10, 0.7], [20, 0.3], [30, 0.7]] as [number, number][], frameWidth: FRAME };
const keysOf = (track: [number, number][]) => track.map(([time, focus]) => ({ time, value: xForFocus(focus, BOX, FRAME), easing: "easeInOut" }));

describe("faceXTrack", () => {
  it("keeps the keys inside the range plus one on each side", () => {
    expect(faceXTrack(keysOf(face.track), face, { start: 12, end: 18 }, BOX)!.map((key) => key.time)).toEqual([10, 20]);
    expect(faceXTrack(keysOf(face.track), face, { start: 9, end: 21 }, BOX)!.map((key) => key.time)).toEqual([0, 10, 20, 30]);
    // A range that starts or ends on a key needs no neighbour on that side.
    expect(faceXTrack(keysOf(face.track), face, { start: 10, end: 20 }, BOX)!.map((key) => key.time)).toEqual([10, 20]);
    // Outside the track on both sides: the nearest key holds.
    expect(faceXTrack(keysOf(face.track), face, { start: 31, end: 40 }, BOX)!.map((key) => key.time)).toEqual([30]);
  });

  it("rebuilds keys a trimmed template lacks from the mark (restored words)", () => {
    const trimmed = keysOf(face.track).slice(1, 3);
    const out = faceXTrack(trimmed, face, { start: 5, end: 25 }, BOX)!;
    expect(out.map((key) => key.time)).toEqual([0, 10, 20, 30]);
    expect(out[0]!.value).toBe(xForFocus(0.3, BOX, FRAME));
    expect(out[1]).toBe(trimmed[0]);
  });

  it("leaves a track with a key of the user's own alone", () => {
    expect(faceXTrack([...keysOf(face.track), { time: 15, value: -900 }], face, { start: 12, end: 18 }, BOX)).toBeNull();
  });
});

describe("cut segments carry only the face keys around their own range", () => {
  const cutOnce = async (minutes = 10) => {
    const { document, context } = longClip(minutes);
    return { document, context, cut: (await applyOps(document, [silence], context)).document };
  };

  it("total x keys stay near two per segment, and a 10-minute clip saves", async () => {
    const { cut } = await cutOnce();
    const counts = xKeys(cut);
    expect(counts.length).toBeGreaterThan(50);
    expect(counts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(41 + 2 * counts.length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(storedBytes(cut)).toBeLessThan(MAX_DOCUMENT_BYTES);
  });

  it("restoring every cut gives the whole track back", async () => {
    const { document, context, cut } = await cutOnce();
    const restored = (await applyOps(cut, [{ op: "restore_all" }], context)).document;
    expect(xTracks(restored)).toEqual(xTracks(document));
  });

  it("9:16 → 1:1 → 9:16 after cutting gives the same x keys", async () => {
    const { context, cut } = await cutOnce();
    const square = (await applyOps(cut, [{ op: "set_frame", width: 1080, height: 1080 }], context)).document;
    const back = (await applyOps(square, [{ op: "set_frame", width: 1080, height: 1920 }], context)).document;
    expect(xTracks(square)).not.toEqual(xTracks(cut));
    expect(xTracks(back)).toEqual(xTracks(cut));
  });

  it("a key of the user's own keeps the point it framed when the frame changes", async () => {
    const { context, cut } = await cutOnce();
    const first = videos(cut)[0] as unknown as { sourceIn: number; tracks: { property: string; keyframes: { time: number; value: number }[] }[] };
    const time = round(first.sourceIn + 0.123);
    first.tracks.find((track) => track.property === "x")!.keyframes.push({ time, value: xFor(0.5) });
    const square = (await applyOps(cut, [{ op: "set_frame", width: 1080, height: 1080 }], context)).document;
    const key = xTracks(square)[0]!.find(([at]) => at === time)!;
    // 1:1 over a 16:9 source: the box is 1920 wide, and focus 0.5 centres it.
    expect(key[1]).toBe(Math.round(xForFocus(0.5, 1920, 1080)));
  });

  it("a key of the user's own survives the next cut", async () => {
    const { context, cut } = await cutOnce();
    const first = videos(cut)[0] as unknown as { sourceIn: number; tracks: { property: string; keyframes: { time: number; value: number }[] }[] };
    first.tracks.find((track) => track.property === "x")!.keyframes.push({ time: round(first.sourceIn + 0.123), value: -777 });
    const again = (await applyOps(cut, [{ op: "remove_silence", min_pause: 0.25, padding: 0.1 }], context)).document;
    expect(JSON.stringify(again)).toContain("-777");
  });
});
