"use client";

/**
 * Gắn giọng đọc đã về vào voiceover của nó (spec voiceover §4): khi khai báo
 * `generate.voice` của một audio có mark `voiceover` đã thành file trong thư
 * viện, hỏi lại generation để lấy độ dài thật + mốc từng chữ, rồi chạy op
 * `sync_voiceover` — `end` của audio đúng độ dài, phụ đề của giọng có transcript.
 *
 * Tách khỏi `useGenerations`: lượt Generate dùng lại (cùng hash, khác tab) cũng
 * phải gắn được, nên điều kiện là "record đã có mà voiceover chưa `synced`",
 * không phải "vừa sinh xong".
 */

import { useEffect, useRef } from "react";

import { isPartial, type LibraryRecord } from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import { activeScene, VOICEOVER_MARK, walk, type VoiceoverMark } from "@opencmo/editor-core";

import type { TransactOptions } from "@/lib/editor/session";

import { generationMatches } from "../media";
import type { LibraryApi } from "../library/useLibrary";

type Word = { text: string; start: number; end: number };
type View = { status: string; asset: { duration: number | null; words: Word[] | null } | null };

const RETRY_MS = 1500;
/** A sync that keeps failing is an op error, not a busy editor: stop instead of looping forever. */
const MAX_ATTEMPTS = 5;

export function useVoiceovers({
  document,
  library,
  run,
  notify,
}: {
  document: ClipDocument;
  library: LibraryApi;
  run: (ops: unknown[], options?: TransactOptions) => Promise<ClipDocument | null>;
  notify: (message: string) => void;
}): void {
  const pending = useRef(new Set<string>());
  const runRef = useRef(run);
  runRef.current = run;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const waiting: { key: string; src: Record<string, unknown>; start: number }[] = [];
    walk(document, ({ entity, tag }) => {
      if (tag !== "audio") return;
      const mark = (entity.marks as Record<string, unknown> | undefined)?.[VOICEOVER_MARK] as VoiceoverMark | undefined;
      const src = entity.src as Record<string, unknown> | undefined;
      if (!mark || mark.synced || !src || typeof src !== "object" || src.generate !== "voice") return;
      waiting.push({ key: mark.key, src, start: typeof entity.start === "number" ? entity.start : 0 });
    });
    const timers: ReturnType<typeof setTimeout>[] = [];
    const [from, to] = activeScene(document).workarea ?? [0, 0];
    for (const { key, src, start } of waiting) {
      if (pending.current.has(key)) continue;
      const record = libraryRef.current
        .latest()
        .assets.find((item) => !isPartial(item) && generationMatches(src, item as never)) as LibraryRecord | undefined;
      const id = record?.generation?.id;
      if (!id) continue;
      pending.current.add(key);
      void attach(key, id, to - from - start).finally(() => pending.current.delete(key));
    }

    async function attach(key: string, id: string, room: number, attempt = 1) {
      const response = await fetch(`/api/v1/generations/${encodeURIComponent(id)}`).catch(() => null);
      const view = response?.ok ? ((await response.json().catch(() => null)) as View | null) : null;
      const duration = view?.asset?.duration;
      if (!duration || duration <= 0) return;
      const words = view?.asset?.words ?? undefined;
      // Bookkeeping, not a user edit: no Undo step. Undoing back past it drops the `synced` mark,
      // and this effect attaches the voiceover again.
      const applied = await runRef.current([{ op: "sync_voiceover", key, duration, ...(words?.length ? { words } : {}) }], {
        history: false,
        origin: "system",
        label: "Attach voiceover",
      });
      if (!applied) {
        if (attempt >= MAX_ATTEMPTS) {
          console.warn(`[editor] gave up attaching voiceover ${key} after ${attempt} attempts`);
          return;
        }
        timers.push(setTimeout(() => void attach(key, id, room, attempt + 1), RETRY_MS));
        return;
      }
      // Export dừng ở cuối clip: giọng dài hơn thì mất đuôi mà timeline vẫn vẽ
      // đủ — thấy được trên file xuất ra là đã quá muộn (đo thật: mất 10s cuối).
      const over = duration - room;
      if (room > 0 && over > 1) {
        notifyRef.current(`The voiceover is ${Math.round(over)}s longer than the clip, so its last words will be cut. Shorten the script and generate again.`);
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [document, library.manifest]);
}
