"use client";

/**
 * Automatic transcripts in the editor (own-video B4). Every library video gets a transcript in the
 * background (Track A). When a file's transcript is ready and that file plays on the timeline, the
 * editor links the element's slice of it with `attach_transcript`: a hidden captions layer, so the
 * video can be read and cut by words, by the Transcript panel and by the Assistant.
 *
 * The attach is its own Undo step (`origin: "system"`), never folded into the user's edit. An
 * element that is already linked is left alone, so placing the file again links only the new one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LibraryRecord, Manifest } from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import { activeView, walk } from "@opencmo/editor-core";

import { mediaOf, sourceRange } from "@/lib/editor/captions-source";
import {
  mediaTranscript,
  transcriptStatuses,
  TranscriptsUnavailable,
  type TranscriptStatus,
} from "@/lib/editor/media-transcript-client";
import type { TransactOptions } from "@/lib/editor/session";

import { libraryRecord } from "../media";

/** How often to ask again while a file is still being transcribed (about a minute per file). */
const POLL_MS = 5000;

const pending = (status: TranscriptStatus | undefined) => status === "queued" || status === "running";

type Entity = Record<string, unknown>;

const mediaIdOf = (record: { cloud?: { state?: string; mediaId?: string } } | null): string | null =>
  record?.cloud?.state === "synced" && typeof record.cloud.mediaId === "string" ? record.cloud.mediaId : null;

/** Video elements of the open timeline that play a stored library file, with no linked transcript. */
function unlinked(document: ClipDocument, manifest: Manifest) {
  const view = activeView(document);
  const linked = new Set<unknown>();
  walk(view, ({ entity }) => {
    if (entity.kind === "captions" && typeof entity.source === "string") linked.add(entity.source);
  });
  const out: { elementId: string; mediaId: string; sourceIn: number; sourceOut: number }[] = [];
  walk(view, ({ entity }) => {
    if (typeof entity.id !== "string" || linked.has(entity.id)) return;
    if (entity.kind !== "video" && entity.kind !== "rect") return;
    const media = mediaOf(entity as Entity);
    if (!media || typeof media.src !== "string") return;
    if (entity.kind === "rect" && !((entity.paints as Entity[] | undefined) ?? []).some((paint) => paint.type === "video")) return;
    const record = libraryRecord(manifest, media.src) as (LibraryRecord & { cloud?: { state?: string; mediaId?: string }; duration?: number }) | null;
    const mediaId = mediaIdOf(record);
    if (!record || !mediaId) return;
    const range = sourceRange(media.timing, typeof record.duration === "number" ? record.duration : undefined);
    if (range.end > range.start) out.push({ elementId: entity.id, mediaId, sourceIn: range.start, sourceOut: range.end });
  });
  return out;
}

export function useAutoTranscripts({
  document,
  manifest,
  clipId,
  run,
}: {
  document: ClipDocument;
  manifest: Manifest;
  clipId: string;
  run: (ops: unknown[], options?: TransactOptions) => Promise<unknown>;
}): { statusOf: (record: LibraryRecord) => TranscriptStatus | null } {
  const [statuses, setStatuses] = useState<Map<string, TranscriptStatus>>(new Map());
  const [retry, setRetry] = useState(0);
  // The server has no automatic transcripts: stop asking for this session.
  const off = useRef(false);
  const attempted = useRef(new Set<string>());

  const mediaIds = useMemo(
    () =>
      [...new Set((manifest.assets ?? []).map((record) => mediaIdOf(record as { cloud?: { state?: string; mediaId?: string } })))]
        .filter((id): id is string => id !== null)
        .sort(),
    [manifest],
  );
  const idsKey = mediaIds.join(",");

  // Ask for the files' status; keep asking while one is still being transcribed.
  useEffect(() => {
    if (off.current || !mediaIds.length) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const next = await transcriptStatuses(mediaIds);
        if (!live) return;
        setStatuses(next);
        if ([...next.values()].some(pending)) timer = setTimeout(() => void ask(), POLL_MS);
      } catch (error) {
        if (error instanceof TranscriptsUnavailable) off.current = true;
        else if (live) timer = setTimeout(() => void ask(), POLL_MS * 3);
      }
    };
    void ask();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // `idsKey` stands for `mediaIds`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Link each ready file's slice to the elements that play it.
  useEffect(() => {
    if (off.current) return;
    for (const item of unlinked(document, manifest)) {
      if (statuses.get(item.mediaId) !== "ready") continue;
      const key = `${item.elementId}|${item.mediaId}|${item.sourceIn}|${item.sourceOut}`;
      if (attempted.current.has(key)) continue;
      attempted.current.add(key);
      void (async () => {
        try {
          const slice = await mediaTranscript({ clipId, mediaId: item.mediaId, sourceIn: item.sourceIn, sourceOut: item.sourceOut });
          if (slice.status === "ready") {
            await run([{ op: "attach_transcript", element_id: item.elementId, src: slice.src }], { label: "Attach transcript", origin: "system" });
          } else if (slice.status === "pending") {
            setTimeout(() => {
              attempted.current.delete(key);
              setRetry((value) => value + 1);
            }, POLL_MS);
          }
        } catch (error) {
          if (error instanceof TranscriptsUnavailable) off.current = true;
          else console.warn("[editor] could not attach a transcript", error);
        }
      })();
    }
  }, [document, manifest, statuses, clipId, run, retry]);

  const statusOf = useCallback(
    (record: LibraryRecord) => {
      const mediaId = mediaIdOf(record as { cloud?: { state?: string; mediaId?: string } });
      return mediaId ? (statuses.get(mediaId) ?? null) : null;
    },
    [statuses],
  );
  return { statusOf };
}
