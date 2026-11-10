"use client";

/**
 * The Script tab (cmo-review-3 I1 and I3): the script the founder records, beside the edit it was opened from.
 *
 * - One row per beat, read from the Writer's order (`GET /clips/[id]/script`), so the tab, the card, the Writer screen
 *   and the prompter show the same words. A row seeks to its beat's marker; the row under the playhead is lit.
 * - Editing a beat writes the order first (`PATCH /cmo/scripts/[id]/beats/[n]`), then the beat's marker comment through
 *   the editor's own op, so the marker change is one Undo step. Undo puts the marker back, not the order: the order
 *   keeps the founder's new words, which is the script everywhere else too.
 * - Once the edit has a take with a transcript, each beat says whether it was said (`matchScript`), and "Keep only the
 *   script" lists the stretches that match no beat (`offScript`). It cuts only when the founder confirms (plan §8).
 */

import { useEffect, useMemo, useState } from "react";

import type { ClipDocument } from "@opencmo/clip-doc";
import {
  keptRanges,
  loadCaptions,
  matchScript,
  offScript,
  readMarkers,
  sourceWords,
  speechOffset,
  speechSources,
  toOutput,
  type CaptionModel,
  type OpContext,
  type Range,
  type Word,
} from "@opencmo/editor-core";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { reportClientError } from "@/lib/client-errors";
import { SHOT_LABEL, scriptMarkers } from "@/lib/cmo/script-markers";
import type { Script } from "@/lib/cmo/script";

const STATUS_TEXT = { said: "Said", partly: "Partly said", missing: "Not said" } as const;

const seconds = (value: number) => `${Math.round(value * 10) / 10} s`;

export function ScriptPanel({
  script,
  onScript,
  onReload,
  doc,
  context,
  busy,
  run,
  playhead,
  onSeek,
}: {
  script: Script;
  /** The script after an edit: new words and version. */
  onScript: (next: Script) => void;
  /** Reads the script again (another tab or the phone changed it). */
  onReload: () => void;
  doc: ClipDocument;
  context: () => OpContext;
  busy: boolean;
  run: (ops: unknown[]) => Promise<unknown>;
  /** The playhead in clip seconds. */
  playhead: number;
  /** Clip seconds. */
  onSeek: (seconds: number) => void;
}) {
  const markers = useMemo(() => readMarkers(doc), [doc]);
  const markerOf = (index: number) => markers.find((marker) => marker.name.startsWith(`${String(index + 1).padStart(2, "0")} · `)) ?? null;
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ say: "", show: "" });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The take: the same speech source the Transcript tab edits (the master, else the only video with speech).
  const sources = useMemo(() => speechSources(doc), [doc]);
  const source = sources.find((item) => item.master) ?? sources[0] ?? null;
  const elementId = source && !source.master ? source.elementId : undefined;
  const [model, setModel] = useState<CaptionModel | null>(null);
  useEffect(() => {
    let live = true;
    if (!source) {
      setModel(null);
      return;
    }
    loadCaptions(doc, context(), elementId).then(
      (next) => live && setModel(next),
      (error) => {
        if (!live) return;
        reportClientError("reported", error, { source: "editor:script-take" });
        setModel(null);
      },
    );
    return () => {
      live = false;
    };
    // Re-read on a document or source change, as the Transcript tab does; `context` changes with the viewport only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, elementId, source?.elementId]);

  const words = useMemo(() => (model ? sourceWords(model.transcript, model.window, model.removed) : []), [model]);
  const takes = useMemo(() => (words.length ? matchScript(script.beats, words) : null), [script.beats, words]);
  const cuts = useMemo(() => (takes ? offScript(words, takes) : []), [takes, words]);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (!cuts.length) setReviewing(false);
  }, [cuts.length]);

  /** Source seconds of the take → clip seconds, past the cuts already made. */
  const toClip = (time: number): number | null => {
    if (!model) return null;
    const out = model.removed.length ? toOutput(time, keptRanges(model.window, model.removed)) : time - model.window.start;
    return out === null ? null : Math.max(0, out + speechOffset(doc, elementId));
  };

  const current = script.beats.findIndex((_, index) => {
    const marker = markerOf(index);
    return marker ? playhead >= marker.time && playhead < marker.time + Math.max(marker.duration, 0.01) : false;
  });

  async function save(index: number) {
    const beat = script.beats[index]!;
    const say = draft.say.trim();
    const show = draft.show.trim();
    if (!say || !show || (say === beat.say && show === beat.show)) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const answer = await api<{ version: string; say: string; show: string }>(
        `/cmo/scripts/${encodeURIComponent(script.orderId)}/beats/${index + 1}`,
        jsonBody({ ...(say !== beat.say ? { say } : {}), ...(show !== beat.show ? { show } : {}), version: script.version }, "PATCH"),
      );
      const beats = script.beats.map((item, i) => (i === index ? { ...item, say: answer.say, show: answer.show } : item));
      onScript({ ...script, beats, version: answer.version });
      setEditing(null);
      // The marker follows the order; a marker the founder deleted comes back for this beat.
      const marker = markerOf(index);
      const comment = `Say: ${answer.say}\nShow: ${answer.show}`;
      await run([marker ? { op: "set_marker", marker_id: marker.id, comment } : scriptMarkers(beats)[index]!]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNote(error.message);
        setEditing(null);
        onReload();
      } else {
        setNote(error instanceof ApiError ? error.message : "Could not save the beat. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  const cutSeconds = cuts.reduce((sum, range) => sum + (range.end - range.start), 0);
  const wordsIn = (range: Range) =>
    words
      .filter((word: Word) => word.start >= range.start - 1e-6 && word.end <= range.end + 1e-6)
      .map((word) => word.text)
      .join(" ");

  return (
    <section className="ed2-trn ed2-scr" data-testid="script-panel" onKeyDown={(event) => event.stopPropagation()}>
      <header className="ed2-scr-head">
        <div className="ed2-scr-title">{script.title}</div>
        <a className="ed2-btn" href={`/app/script/${encodeURIComponent(script.orderId)}/prompter`} target="_blank" rel="noopener noreferrer">
          Read on your phone
        </a>
      </header>
      {note ? (
        <p className="ed2-scr-note" role="status">
          {note}
        </p>
      ) : null}
      <div className="ed2-trn-text">
        {script.hooks.length ? (
          <div className="ed2-scr-hooks">
            <div className="ed2-scr-label">Hooks</div>
            <ol>
              {script.hooks.map((hook) => (
                <li key={hook}>{hook}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <ol className="ed2-scr-beats">
          {script.beats.map((beat, index) => {
            const take = takes?.[index];
            const marker = markerOf(index);
            return (
              <li key={index} className={index === current ? "ed2-scr-beat is-current" : "ed2-scr-beat"} data-testid="script-beat">
                {editing === index ? (
                  <form
                    className="ed2-scr-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(index);
                    }}
                  >
                    <label>
                      <span className="ed2-scr-label">Say</span>
                      <textarea className="ed2-scr-input" maxLength={300} value={draft.say} autoFocus aria-label={`What to say in beat ${index + 1}`}
                        onChange={(event) => setDraft((d) => ({ ...d, say: event.target.value }))} />
                    </label>
                    <label>
                      <span className="ed2-scr-label">Show</span>
                      <textarea className="ed2-scr-input" maxLength={300} value={draft.show} aria-label={`What to show in beat ${index + 1}`}
                        onChange={(event) => setDraft((d) => ({ ...d, show: event.target.value }))} />
                    </label>
                    <div className="ed2-row">
                      <button type="submit" className="ed2-btn is-primary" disabled={saving || !draft.say.trim() || !draft.show.trim()}>
                        Save
                      </button>
                      <button type="button" className="ed2-btn" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ed2-scr-row"
                      aria-label={`Go to beat ${index + 1}`}
                      disabled={!marker && !(take?.start !== undefined)}
                      onClick={() => {
                        // A said beat seeks to where it was said; otherwise to its marker.
                        const at = take?.status !== "missing" && take?.start !== undefined ? toClip(take.start) : null;
                        if (at !== null) onSeek(at);
                        else if (marker) onSeek(marker.time);
                      }}
                    >
                      <span className="ed2-scr-meta">
                        <span className="ed2-scr-num">{String(index + 1).padStart(2, "0")}</span>
                        <span>{SHOT_LABEL[beat.shot]}</span>
                        <span>{seconds(beat.seconds)}</span>
                        {take ? (
                          <span className={`ed2-scr-take is-${take.status}`} data-testid="script-take">
                            {STATUS_TEXT[take.status]}
                            {take.takes > 1 ? ` · ${take.takes} takes, the last kept` : ""}
                          </span>
                        ) : null}
                      </span>
                      <span className="ed2-scr-line">
                        <span className="ed2-scr-label">Say</span> {beat.say}
                      </span>
                      <span className="ed2-scr-line">
                        <span className="ed2-scr-label">Show</span> {beat.show}
                      </span>
                      {take?.status === "missing" ? <span className="ed2-scr-missing">Beat {index + 1} is missing</span> : null}
                    </button>
                    <button
                      type="button"
                      className="ed2-btn ed2-scr-edit"
                      aria-label={`Edit beat ${index + 1}`}
                      disabled={saving}
                      onClick={() => {
                        setDraft({ say: beat.say, show: beat.show });
                        setEditing(index);
                      }}
                    >
                      Edit
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {cuts.length ? (
        <footer className="ed2-trn-foot" data-testid="script-keep">
          {reviewing ? (
            <>
              <p className="ed2-scr-note">
                {cuts.length} {cuts.length === 1 ? "stretch" : "stretches"}, {seconds(cutSeconds)}: false starts, retakes and asides. Nothing is cut until you confirm.
              </p>
              <ul className="ed2-scr-cuts">
                {cuts.map((range) => (
                  <li key={`${range.start}-${range.end}`}>
                    <button type="button" className="ed2-scr-cut" onClick={() => {
                      const at = toClip(range.start);
                      if (at !== null) onSeek(at);
                    }}>
                      <span className="ed2-scr-num">{seconds(range.end - range.start)}</span> {wordsIn(range)}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="ed2-row">
                <button
                  type="button"
                  className="ed2-btn is-primary"
                  disabled={busy}
                  data-testid="script-keep-confirm"
                  onClick={() => {
                    setReviewing(false);
                    void run([{ op: "remove_ranges", ranges: cuts, ...(elementId ? { element_id: elementId } : {}) }]);
                  }}
                >
                  Cut {cuts.length === 1 ? "it" : `all ${cuts.length}`}
                </button>
                <button type="button" className="ed2-btn" onClick={() => setReviewing(false)}>
                  Keep them
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="ed2-btn" disabled={busy} data-testid="script-keep-open" onClick={() => setReviewing(true)}>
              Keep only the script
            </button>
          )}
        </footer>
      ) : null}
    </section>
  );
}

