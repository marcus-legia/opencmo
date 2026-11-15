/**
 * Bench harness for the timeline (plan 2026-11-15, B0/B4): renders the real `Timeline` on a
 * synthetic long edit, in a plain page with no Supabase, worker or media. Built by `run.mts`
 * with esbuild and driven by Playwright. Not imported by the app.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { ClipDocument } from "@opencmo/clip-doc";
import type { OpContext } from "@opencmo/editor-core";
import { applyOps } from "@opencmo/editor-core";

import type { BrowserMedia } from "../../media";
import { Timeline } from "../Timeline";

const params = new URLSearchParams(location.search);
const MINUTES = Number(params.get("minutes") ?? 30);
const CUTS = Number(params.get("cuts") ?? 400);
const SECONDS = MINUTES * 60;

/** A long talking-head edit: the master cut by words into `CUTS` pieces, captions, b-roll, music. */
function syntheticDoc(): ClipDocument {
  const piece = SECONDS / CUTS;
  const cuts = Array.from({ length: CUTS }, (_, index) => ({
    kind: "video",
    id: `cut${index}`,
    src: "assets/master.mp4",
    x: 0, y: 0, width: 1080, height: 1920,
    // Cut segments carry their own start, back to back (as `captions.ts` writes them).
    start: index * piece * 0.9,
    sourceIn: index * piece,
    sourceOut: index * piece + piece * 0.9,
  }));
  const broll = Array.from({ length: 40 }, (_, index) => ({
    kind: "rect", id: `broll${index}`, name: `B-roll ${index + 1}`, x: 0, y: 0, width: 1080, height: 1920,
    start: index * (SECONDS / 40) + 2, end: index * (SECONDS / 40) + 5,
    paints: [{ type: "video", src: `library/broll${index}.mp4` }],
    marks: { lane: "visual" },
  }));
  return {
    version: 1,
    stage: {
      children: [{
        kind: "scene", id: "scene", width: 1080, height: 1920, fill: "#000000", active: true,
        children: [
          { kind: "sequence", id: "talk", name: "Talk", children: cuts },
          { kind: "sequence", id: "brollrow", name: "B-roll", marks: { lane: "visual" }, children: broll },
          { kind: "audio", id: "music", src: "library/music.mp3", start: 0, sourceIn: 0, sourceOut: SECONDS },
          { kind: "captions", id: "captions", src: "assets/transcript.json", preset: "classic", start: 0, sourceIn: 0, sourceOut: SECONDS },
        ],
      }],
    },
  } as unknown as ClipDocument;
}

const WORDS = Array.from({ length: Math.round(SECONDS * 2.5) }, (_, index) => ({
  text: `word${index}`, start: index / 2.5, end: index / 2.5 + 0.35,
}));
const TRANSCRIPT = [{ text: "", words: WORDS }];

const durations = (src: unknown): number | null => {
  if (src === "assets/master.mp4" || src === "library/music.mp3") return SECONDS;
  if (typeof src === "string" && src.startsWith("library/broll")) return 6;
  return null;
};

// Only what the timeline reads. No bytes: waveforms stay empty, which is the cheap case.
const media = {
  duration: durations,
  transcript: (src: string) => (src === "assets/transcript.json" ? TRANSCRIPT : null),
  transcriptStatus: () => "ready",
  bytesOf: async () => null,
  image: () => ({ status: "loading" }),
  video: () => ({ status: "loading" }),
  lut: () => null,
} as unknown as BrowserMedia;

const context = (): OpContext => ({ master: { width: 1080, height: 1920 }, media: media as never }) as unknown as OpContext;

function App() {
  const committed = useRef(syntheticDoc());
  const [doc, setDoc] = useState(committed.current);
  const [preview, setPreview] = useState<ClipDocument | null>(null);
  const [frame, setFrame] = useState(SECONDS * 15);
  const [selection, setSelection] = useState<string[]>([]);
  const run = useCallback(async (ops: unknown[]) => {
    const applied = await applyOps(committed.current, ops, context());
    committed.current = applied.document;
    setDoc(applied.document);
    return applied;
  }, []);
  const base = useMemo(() => () => committed.current, []);
  return (
    <div style={{ height: "100vh", display: "grid", background: "var(--ds-ink-3)", color: "var(--ds-text)" }}>
      <Timeline
        doc={preview ?? doc}
        base={base}
        media={media}
        generation={0}
        frame={frame}
        playing={false}
        onSeek={setFrame}
        onToggle={() => undefined}
        context={context}
        run={run}
        onPreview={setPreview}
        selection={selection}
        onSelect={setSelection}
        solo={null}
        onSolo={() => undefined}
        onSplit={() => undefined}
        onDropMedia={() => undefined}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
