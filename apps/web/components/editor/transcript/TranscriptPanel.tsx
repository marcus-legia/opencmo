"use client";

/**
 * Tab Transcript (checklist OCM-01): sửa clip bằng chữ — sửa từ sai, tách/gộp
 * dòng phụ đề, chỉnh mốc từng từ, và xoá một đoạn khỏi video bằng cách chọn
 * chữ của nó.
 *
 * Panel làm việc trên transcript NGUỒN và danh sách khoảng đã xoá
 * (`loadCaptions`); phụ đề và các đoạn video được DỰNG LẠI từ hai thứ đó trong
 * editor-core. Mỗi nút là một op của registry — cùng op mà route
 * `/editor/ops`, Assistant và panel của fork dùng — nên mỗi lượt là một bước
 * Undo và đi qua autosave như mọi lượt sửa khác.
 *
 * "Add title" turns selected words into a name tag or lower third that appears when they are
 * spoken: the title is pre-filled with the words, the quote is the same words.
 */

import { useEffect, useMemo, useState } from "react";

import type { ClipDocument } from "@opencmo/clip-doc";
import {
  NUDGE,
  VOICEOVER_MARK,
  isRemoved,
  keptRanges,
  loadCaptions,
  search,
  speechOffset,
  speechSources,
  toOutput,
  walk,
  type CaptionModel,
  type OpContext,
  type Transcript,
  type Word,
} from "@opencmo/editor-core";

type At = [number, number];
const key = (at: At) => `${at[0]}:${at[1]}`;

/** Selected words → a title: no surrounding punctuation, at most 60 characters on a word boundary. */
function titleFrom(text: string): string {
  const clean = text.replace(/^[\s"'“”‘’.,;:!?…-]+|[\s"'“”‘’.,;:!?…-]+$/g, "");
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 60).trim();
}

type TitleDraft = { title: string; sub: string; quote: string };

export function TranscriptPanel({
  doc,
  context,
  busy,
  run,
  onSeek,
  selection = [],
}: {
  doc: ClipDocument;
  context: () => OpContext;
  busy: boolean;
  run: (ops: unknown[]) => Promise<unknown>;
  /** Giây trên trục ra của clip (sau cắt). */
  onSeek: (seconds: number) => void;
  /** Selected elements: a selected video with speech opens on its own transcript. */
  selection?: string[];
}) {
  // Which video's words the panel edits: the one picked here, else a selected video with speech,
  // else the main video (or the only one).
  const sources = useMemo(() => speechSources(doc), [doc]);
  const [picked, setPicked] = useState<string | null>(null);
  const source =
    sources.find((item) => item.elementId === picked) ??
    sources.find((item) => selection.includes(item.elementId)) ??
    sources.find((item) => item.master) ??
    sources[0] ??
    null;
  // The master is the default source: its ops stay as they were (no `element_id`).
  const elementId = source && !source.master ? source.elementId : undefined;
  const [model, setModel] = useState<CaptionModel | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<At | null>(null);
  const [focus, setFocus] = useState<At | null>(null);
  const [editing, setEditing] = useState<At | null>(null);
  // Độ chặt khi cắt chữ (học Palmier §B2): "words" chỉ cắt chữ, còn lại ăn luôn khoảng lặng hai bên.
  const [tightness, setTightness] = useState<"words" | "tight" | "balanced" | "loose">("balanced");
  const [minPause, setMinPause] = useState("0.5");
  const [titleDraft, setTitleDraft] = useState<TitleDraft | null>(null);

  // Đọc lại mỗi khi document đổi — kể cả Undo, sửa từ timeline hay Assistant.
  useEffect(() => {
    let live = true;
    loadCaptions(doc, context(), elementId).then(
      (next) => {
        if (!live) return;
        setModel(next);
        setStatus(next ? "ready" : "none");
      },
      (error) => {
        if (!live) return;
        console.error("[transcript] could not load", error);
        setStatus("error");
      },
    );
    return () => {
      live = false;
    };
    // `context` changes with the viewport, the transcript does not: re-read on document or source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, elementId]);

  const flat = useMemo(
    () => (model?.transcript ?? []).flatMap((segment, s) => segment.words.map((word, w) => ({ at: [s, w] as At, word }))),
    [model],
  );
  const indexOf = (at: At | null) => (at ? flat.findIndex((entry) => key(entry.at) === key(at)) : -1);
  // Vùng chọn là một dải liền theo thứ tự đọc, từ `anchor` tới `focus`.
  const selected = useMemo(() => {
    const a = indexOf(anchor);
    const b = indexOf(focus);
    return a < 0 || b < 0 ? [] : flat.slice(Math.min(a, b), Math.max(a, b) + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, anchor, focus]);
  const selectedKeys = useMemo(() => new Set(selected.map((entry) => key(entry.at))), [selected]);
  const hits = useMemo(() => new Set(search(model?.transcript ?? [], query).map((at) => key(at as At))), [model, query]);

  const picker =
    sources.length > 1 ? (
      <label className="ed2-trn-opt ed2-trn-source">
        <span>Video</span>
        <select
          value={source?.elementId ?? ""}
          aria-label="Which video's words to edit"
          data-testid="transcript-source"
          onChange={(event) => {
            setPicked(event.target.value);
            setAnchor(null);
            setFocus(null);
          }}
        >
          {sources.map((item) => (
            <option key={item.elementId} value={item.elementId} data-testid={`transcript-source-${item.elementId}`}>
              {item.name}
              {item.transcript ? "" : " (no transcript yet)"}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  if (status !== "ready" || !model) {
    return (
      <section className="ed2-trn" data-testid="transcript-panel">
        {picker}
        <p className={status === "error" ? "ed2-error ed2-trn-note" : "ed2-muted ed2-trn-note"}>
          {status === "loading"
            ? "Loading the transcript…"
            : status === "none"
              ? "This clip has no video speech to edit. Add a voiceover with captions, or select a video or audio and use Generate captions in the inspector."
              : "The transcript could not be loaded. Reload the page to try again."}
        </p>
        <div className="ed2-trn-text">
          <VoiceoverTranscript doc={doc} context={context} onSeek={onSeek} />
        </div>
      </section>
    );
  }

  const removed = (word: Word) => isRemoved(word, model.removed);
  const single = selected.length === 1 ? selected[0]! : null;
  const anyKept = selected.some((entry) => !removed(entry.word));
  const anyRemoved = selected.some((entry) => removed(entry.word));
  // Words without an id cannot be named to an op.
  const ids = () => selected.flatMap((entry) => (entry.word.id === undefined ? [] : [entry.word.id]));
  // One op for the whole selection: split ops would each refuse a part that is all cut words.
  const emphasis = (remove: boolean) => {
    const all = ids();
    return all.length ? [{ op: "emphasize_words", quotes: [], word_ids: all, ...(remove ? { remove: true } : {}) }] : [];
  };
  const cutWords = () => ({ op: "remove_words", word_ids: ids(), ...(tightness === "words" ? {} : { tightness }) });

  const act = (ops: unknown[], clear = false) => {
    if (busy || !ops.length) return;
    if (clear) {
      setAnchor(null);
      setFocus(null);
    }
    void run(elementId ? ops.map((op) => ({ ...(op as object), element_id: elementId })) : ops);
  };

  const seekTo = (word: Word) => {
    const time = model.removed.length
      ? toOutput(word.start, keptRanges(model.window, model.removed))
      : word.start - model.window.start;
    // A video placed later on the timeline starts at its own clip second.
    if (time !== null) onSeek(Math.max(0, time + speechOffset(doc, elementId)));
  };

  const nudge = (edge: "start" | "end", seconds: number) =>
    single && act([{ op: "nudge_word", word_id: single.word.id, edge, seconds }], true);

  // The quote locates the words in the clip's own transcript, so titles come from the main video only.
  const canTitle = !elementId && selected.length > 0 && !anyRemoved;
  const startTitle = () => {
    const words = selected.map((entry) => entry.word.text);
    // The first dozen words are enough to find the line; the title starts on the first one.
    setTitleDraft({ title: titleFrom(words.join(" ")), sub: "", quote: words.slice(0, 12).join(" ").slice(0, 300) });
  };
  const addTitle = () => {
    if (busy || !titleDraft || !titleDraft.title.trim()) return;
    const sub = titleDraft.sub.trim();
    void run([{ op: "add_title", kind: "lowerThird", title: titleDraft.title.trim().slice(0, 60), ...(sub ? { sub: sub.slice(0, 80) } : {}), quote: titleDraft.quote }]);
    setTitleDraft(null);
    setAnchor(null);
    setFocus(null);
  };

  const commitEdit = (word: Word, text: string) => {
    setEditing(null);
    if (text.trim() && text !== word.text) act([{ op: "edit_words", edits: [{ word_id: word.id, text }] }], true);
  };

  return (
    <section
      className="ed2-trn"
      data-testid="transcript-panel"
      tabIndex={0}
      onKeyDown={(event) => {
        // Phím trong panel là của panel: Delete ở đây là "xoá chữ khỏi video",
        // không phải xoá phần tử đang chọn trên canvas.
        event.stopPropagation();
        if (editing) return;
        if ((event.key === "Delete" || event.key === "Backspace") && anyKept) {
          event.preventDefault();
          act([cutWords()]);
        } else if (event.key === "Escape") {
          setAnchor(null);
          setFocus(null);
          setTitleDraft(null);
        }
      }}
    >
      <input
        className="ed2-trn-search"
        type="search"
        placeholder="Search the transcript"
        aria-label="Search the transcript"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {picker}
      <div className="ed2-row ed2-wrap ed2-trn-tools">
        <label className="ed2-trn-opt">
          <span>Cut</span>
          <select value={tightness} onChange={(event) => setTightness(event.target.value as typeof tightness)} aria-label="How much pause to leave when cutting words" data-testid="transcript-tightness">
            <option value="words">Words only</option>
            <option value="tight">Tight</option>
            <option value="balanced">Balanced</option>
            <option value="loose">Loose</option>
          </select>
        </label>
        <span className="ed2-grow" />
        <label className="ed2-trn-opt">
          <span>Pauses over</span>
          <select value={minPause} onChange={(event) => setMinPause(event.target.value)} aria-label="Shortest pause to remove">
            <option value="0.3">0.3s</option>
            <option value="0.5">0.5s</option>
            <option value="1">1s</option>
          </select>
        </label>
        <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-remove-pauses"
          onClick={() => act([{ op: "remove_silence", min_pause: Number(minPause), padding: 0.15 }])}>
          Remove pauses
        </button>
      </div>
      <div className="ed2-trn-text" aria-busy={busy}>
        {model.transcript.map((segment, s) => (
          <p key={s} className="ed2-trn-line" data-testid="transcript-line">
            {segment.words.map((word, w) => {
              const at: At = [s, w];
              if (editing && key(editing) === key(at)) {
                return (
                  <input
                    key={word.id ?? w}
                    className="ed2-rename ed2-trn-edit"
                    aria-label="Edit word"
                    autoFocus
                    defaultValue={word.text}
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") commitEdit(word, event.currentTarget.value);
                      if (event.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => setEditing(null)}
                  />
                );
              }
              const cls = ["ed2-trn-word"];
              if (selectedKeys.has(key(at))) cls.push("is-selected");
              if (hits.has(key(at))) cls.push("is-hit");
              if (removed(word)) cls.push("is-removed");
              return (
                <span key={word.id ?? w}>
                  <span
                    role="button"
                    className={cls.join(" ")}
                    data-testid="transcript-word"
                    data-removed={removed(word)}
                    onClick={(event) => {
                      if (event.shiftKey && anchor) {
                        setFocus(at);
                      } else {
                        setAnchor(at);
                        setFocus(at);
                        seekTo(word);
                      }
                    }}
                    onDoubleClick={() => !removed(word) && setEditing(at)}
                  >
                    {word.text}
                  </span>{" "}
                </span>
              );
            })}
          </p>
        ))}
        <VoiceoverTranscript doc={doc} context={context} onSeek={onSeek} />
      </div>

      <footer className="ed2-trn-foot">
        {titleDraft ? (
          <div className="ed2-row ed2-wrap" data-testid="transcript-title-form">
            <input
              className="ed2-select ed2-grow"
              aria-label="Title"
              placeholder="Name or title"
              maxLength={60}
              autoFocus
              data-testid="transcript-title-text"
              value={titleDraft.title}
              onChange={(event) => setTitleDraft({ ...titleDraft, title: event.target.value })}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") addTitle();
                if (event.key === "Escape") setTitleDraft(null);
              }}
            />
            <input
              className="ed2-select ed2-grow"
              aria-label="Role (optional)"
              placeholder="Role, e.g. Founder, Paylane (optional)"
              maxLength={80}
              data-testid="transcript-title-sub"
              value={titleDraft.sub}
              onChange={(event) => setTitleDraft({ ...titleDraft, sub: event.target.value })}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") addTitle();
                if (event.key === "Escape") setTitleDraft(null);
              }}
            />
            <button type="button" className="ed2-btn ed2-primary" disabled={busy || !titleDraft.title.trim()} data-testid="transcript-title-add" onClick={addTitle}>
              Add
            </button>
            <button type="button" className="ed2-btn" onClick={() => setTitleDraft(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        {selected.length ? (
          <div className="ed2-row ed2-wrap">
            {anyKept ? (
              <button type="button" className="ed2-btn ed2-danger" disabled={busy} data-testid="transcript-remove"
                onClick={() => act([cutWords()])}>
                Remove from video
              </button>
            ) : null}
            {anyRemoved ? (
              <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-restore"
                onClick={() => act([{ op: "restore_words", word_ids: ids() }])}>
                Restore
              </button>
            ) : null}
            {anyKept ? (
              <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-emphasize" title="Color these words in the captions"
                onClick={() => act(emphasis(false))}>
                Emphasize
              </button>
            ) : null}
            {anyKept ? (
              <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-unemphasize"
                onClick={() => act(emphasis(true))}>
                Plain
              </button>
            ) : null}
            {canTitle && !titleDraft ? (
              <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-add-title" title="A name tag that appears when these words are spoken" onClick={startTitle}>
                Add title
              </button>
            ) : null}
            {single && !removed(single.word) ? (
              <button type="button" className="ed2-btn" disabled={busy} onClick={() => setEditing(single.at)}>
                Edit word
              </button>
            ) : null}
            {single && single.at[1] > 0 ? (
              <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-split"
                onClick={() => act([{ op: "split_line", word_id: single.word.id }], true)}>
                New line here
              </button>
            ) : null}
            {single && single.at[0] < model.transcript.length - 1 ? (
              <button type="button" className="ed2-btn" disabled={busy} data-testid="transcript-merge"
                onClick={() => act([{ op: "merge_lines", word_id: single.word.id }], true)}>
                Join with next line
              </button>
            ) : null}
          </div>
        ) : (
          <p className="ed2-muted">Click a word to jump there. Shift-click to select a passage, then remove it from the video.</p>
        )}
        {single && !removed(single.word) ? (
          <div className="ed2-row ed2-trn-nudge">
            <span>Start</span>
            <button type="button" className="ed2-icon" aria-label="Move start earlier" disabled={busy} onClick={() => nudge("start", -NUDGE)}>−</button>
            <button type="button" className="ed2-icon" aria-label="Move start later" disabled={busy} onClick={() => nudge("start", NUDGE)}>+</button>
            <span>End</span>
            <button type="button" className="ed2-icon" aria-label="Move end earlier" disabled={busy} onClick={() => nudge("end", -NUDGE)}>−</button>
            <button type="button" className="ed2-icon" aria-label="Move end later" disabled={busy} onClick={() => nudge("end", NUDGE)}>+</button>
            <span className="ed2-grow" />
            <span className="ed2-time" data-testid="transcript-timing">
              {single.word.start.toFixed(2)}–{single.word.end.toFixed(2)}s
            </span>
          </div>
        ) : null}
        {model.removed.length ? (
          <div className="ed2-row">
            <span className="ed2-muted" data-testid="transcript-cuts">
              {model.removed.length} {model.removed.length === 1 ? "cut" : "cuts"} in this clip
            </span>
            <span className="ed2-grow" />
            <button type="button" className="ed2-link" disabled={busy} data-testid="transcript-restore-all"
              onClick={() => act([{ op: "restore_all" }])}>
              Restore all
            </button>
          </div>
        ) : null}
      </footer>
    </section>
  );
}

/**
 * Lời của voiceover (UAT 09/10: voiceover phải thành transcript): mỗi lớp phụ đề
 * của giọng mới là một khối, bấm một dòng là nhảy tới đó. Chỉ đọc — lời của giọng
 * đổi bằng cách sinh lại voiceover.
 */
function VoiceoverTranscript({ doc, context, onSeek }: { doc: ClipDocument; context: () => OpContext; onSeek: (seconds: number) => void }) {
  const [blocks, setBlocks] = useState<{ name: string; start: number; hidden: boolean; transcript: Transcript }[]>([]);
  useEffect(() => {
    let live = true;
    const layers: { name: string; start: number; hidden: boolean; src: string }[] = [];
    walk(doc, ({ entity, tag }) => {
      if (tag !== "captions" || typeof entity.src !== "string") return;
      if (!(entity.marks as Record<string, unknown> | undefined)?.[VOICEOVER_MARK]) return;
      layers.push({ name: String(entity.name ?? "Voiceover captions"), start: typeof entity.start === "number" ? entity.start : 0, hidden: entity.hidden === true, src: entity.src });
    });
    Promise.all(layers.map(async (layer) => ({ ...layer, transcript: await context().readTranscript(layer.src) }))).then(
      (loaded) => live && setBlocks(loaded),
      (error) => console.error("[transcript] voiceover could not load", error),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  if (!blocks.length) return null;
  return (
    <>
      {blocks.map((block, index) => (
        <div key={index} data-testid="voiceover-transcript">
          <p className="ed2-muted">
            {block.name}
            {block.hidden ? " (hidden)" : ""}
          </p>
          {block.transcript.map((segment, s) => (
            <p key={s} className="ed2-trn-line">
              <span role="button" className="ed2-trn-word" onClick={() => onSeek(block.start + (segment.words[0]?.start ?? 0))}>
                {segment.text}
              </span>
            </p>
          ))}
        </div>
      ))}
    </>
  );
}
