"use client";

/**
 * Edit the speaker's own video with words (right-click on the speaker → "Edit with AI…"): the user
 * describes the change for a range and sees its price. Submits one `edit_video` op, so it lands and
 * undoes as one step.
 */

import { useState } from "react";

import { editSeconds } from "@opencmo/editor-core";
import { priceOf } from "@opencmo/editor-core/generate";

import { liveModels } from "./GeneratePanel";

const randomSeed = () => Math.floor(Math.random() * 2_147_483_647);
const round = (value: number) => Math.round(value * 100) / 100;

export function EditVideoPanel({
  enabled,
  range,
  aspect,
  busy,
  onApply,
  onClose,
}: {
  enabled: Set<string> | null;
  /** Scene seconds the edit covers by default (from the playhead). */
  range: { start: number; end: number };
  aspect: string;
  busy: boolean;
  onApply: (ops: unknown[]) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [start, setStart] = useState(round(range.start));
  const [end, setEnd] = useState(round(range.end));
  const model = liveModels().find((item) => item.limits.clipVideo && enabled?.has(item.id));
  const allowed = model ? editSeconds(model.id) : [];
  const seconds = Math.ceil(round(end - start) - 1e-6);
  const valid = end > start && allowed.includes(seconds);
  const price = model && valid ? priceOf(model, { prompt: prompt || "x", aspectRatio: aspect, duration: seconds } as never) : null;

  const submit = () => {
    if (!model || !valid || !prompt.trim()) return;
    onApply([{ op: "edit_video", start, end, model: model.id, prompt: prompt.trim(), seed: randomSeed() }]);
    onClose();
  };

  return (
    <div className="ed2-gen" data-testid="edit-video-panel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="ed2-row">
        <strong>Edit your video with AI</strong>
        <span className="ed2-grow" />
        <button type="button" className="ed2-icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="ed2-muted">Describe what to change: light, setting, style or weather. Your movement and the camera stay; your sound keeps playing. No real people or logos.</p>
      <textarea
        className="ed2-asst-input"
        autoFocus
        rows={3}
        aria-label="What to change"
        data-testid="edit-video-prompt"
        placeholder="Night time, warm desk lamp, city lights through the window"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="ed2-row">
        <span className="ed2-grow" />
        <label className="ed2-muted">
          From{" "}
          <input className="ed2-bg-time" type="number" step={0.1} min={0} value={start} data-testid="edit-video-start" onChange={(event) => setStart(Number(event.target.value))} />
        </label>
        <label className="ed2-muted">
          to <input className="ed2-bg-time" type="number" step={0.1} min={0} value={end} data-testid="edit-video-end" onChange={(event) => setEnd(Number(event.target.value))} /> s
        </label>
      </div>
      <div className="ed2-row">
        {!valid && allowed.length ? <span className="ed2-error">Pick {Math.min(...allowed)} to {Math.max(...allowed)} seconds.</span> : null}
        <span className="ed2-grow" />
        <span className="ed2-muted" data-testid="edit-video-price">
          {price === null ? "" : `${price} ${price === 1 ? "credit" : "credits"}`}
        </span>
        <button type="button" className="ed2-btn ed2-primary" data-testid="edit-video-submit" disabled={!prompt.trim() || !valid || busy || !model} onClick={submit}>
          Edit video
        </button>
      </div>
    </div>
  );
}
