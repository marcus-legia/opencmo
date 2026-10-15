"use client";

/**
 * Captions for explainers (`docs/explainer-v2-build.md`, C4). When an explainer's render is in the
 * library, ask its generation for the voice's word timings and run `sync_explainer`: one visible
 * captions layer of the narration, which the user can restyle, translate or hide.
 *
 * The condition is "the render is here and the layer has no captions", not "it just finished", so
 * explainers placed before v2 get captions too once their generation has words. Each layer is
 * captioned once per browser: deleting its captions layer is the user's choice and is not undone
 * on the next load. The sync is its own Undo step (`origin: "system"`), never folded into the user's
 * edit. A generation without words (the fake voice) adds nothing.
 */

import { useEffect, useRef } from "react";

import { isPartial, type LibraryRecord } from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import { EXPLAINER_MODEL, walk } from "@opencmo/editor-core";

import type { TransactOptions } from "@/lib/editor/session";

import { generationMatches } from "../media";
import type { LibraryApi } from "../library/useLibrary";

type Word = { text: string; start: number; end: number };
type View = { status: string; asset: { words: Word[] | null } | null };
type Entity = Record<string, unknown>;

const doneKey = (generationId: string, elementId: string) => `opencmo:explainer-captions:${generationId}:${elementId}`;

function wasDone(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markDone(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Private window or blocked storage: the layer may be captioned again on the next load.
  }
}

/** Explainer layers of the document that have no captions layer yet. */
export function uncaptionedExplainers(document: ClipDocument): { elementId: string; src: Entity }[] {
  const captioned = new Set<unknown>();
  const out: { elementId: string; src: Entity }[] = [];
  walk(document, ({ entity }) => {
    if (entity.kind === "captions" && typeof entity.source === "string") captioned.add(entity.source);
  });
  walk(document, ({ entity }) => {
    if (entity.kind !== "rect" || typeof entity.id !== "string" || captioned.has(entity.id)) return;
    for (const paint of (entity.paints as Entity[] | undefined) ?? []) {
      const src = paint.type === "video" ? (paint.src as Entity | undefined) : undefined;
      if (src && typeof src === "object" && src.generate === "video" && src.model === EXPLAINER_MODEL) {
        out.push({ elementId: entity.id, src });
        return;
      }
    }
  });
  return out;
}

export function useExplainers({
  document,
  library,
  run,
}: {
  document: ClipDocument;
  library: LibraryApi;
  run: (ops: unknown[], options?: TransactOptions) => Promise<ClipDocument | null>;
}): void {
  // Asked this session (with or without words): one request per layer and generation.
  const asked = useRef(new Set<string>());
  const runRef = useRef(run);
  runRef.current = run;
  const libraryRef = useRef(library);
  libraryRef.current = library;

  useEffect(() => {
    for (const { elementId, src } of uncaptionedExplainers(document)) {
      const record = libraryRef.current
        .latest()
        .assets.find((item) => !isPartial(item) && generationMatches(src, item as never)) as LibraryRecord | undefined;
      const id = record?.generation?.id;
      if (!id) continue;
      const key = doneKey(id, elementId);
      if (asked.current.has(key) || wasDone(key)) continue;
      asked.current.add(key);
      void attach(elementId, id, key);
    }

    async function attach(elementId: string, id: string, key: string) {
      const response = await fetch(`/api/v1/generations/${encodeURIComponent(id)}`).catch(() => null);
      const view = response?.ok ? ((await response.json().catch(() => null)) as View | null) : null;
      if (!view) {
        // Network or server trouble: ask again on the next change of the document.
        asked.current.delete(key);
        return;
      }
      const words = view.asset?.words;
      if (!words?.length) return;
      const applied = await runRef.current([{ op: "sync_explainer", element_id: elementId, words }], {
        label: "Add explainer captions",
        origin: "system",
      });
      if (applied) markDone(key);
      else console.warn(`[editor] could not add captions to explainer ${elementId}`);
    }
  }, [document, library.manifest]);
}
