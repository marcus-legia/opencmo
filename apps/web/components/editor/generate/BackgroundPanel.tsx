"use client";

/**
 * Replace the background behind the speaker (right-click on the speaker): the user describes the
 * new place and sees the price of both parts, the AI cut-out of their video and the background.
 * Submits one `replace_background` op, so it lands and undoes as one step.
 */

import { useState } from "react";

import { MAX_SWAP_SECONDS } from "@opencmo/editor-core";
import { priceOf } from "@opencmo/editor-core/generate";

import { liveModels } from "./GeneratePanel";

const randomSeed = () => Math.floor(Math.random() * 2_147_483_647);
const round = (value: number) => Math.round(value * 100) / 100;

export function BackgroundPanel({
  enabled,
  range,
  aspect,
  busy,
  onApply,
  onClose,
}: {
  enabled: Set<string> | null;
  /** Scene seconds the swap covers by default (from the playhead). */
  range: { start: number; end: number };
  aspect: string;
  busy: boolean;
  onApply: (ops: unknown[]) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [start, setStart] = useState(round(range.start));
  const [end, setEnd] = useState(round(range.end));
  const live = (pick: (model: ReturnType<typeof liveModels>[number]) => boolean) => liveModels().find((model) => pick(model) && enabled?.has(model.id));
  const cutout = live((model) => !!model.limits.removeBackground);
  const scenery = live((model) => model.kind === kind && !model.limits.scene && !model.limits.sourceVideo);
  const length = round(end - start);
  const valid = length > 0 && length <= MAX_SWAP_SECONDS;
  const price =
    cutout && scenery && valid
      ? priceOf(cutout, { prompt: "Remove background", aspectRatio: aspect, duration: Math.ceil(length) } as never) +
        priceOf(scenery, { prompt: prompt || "x", aspectRatio: aspect, ...(kind === "video" ? { duration: 5 } : {}) } as never)
      : null;

  const submit = () => {
    if (!cutout || !scenery || !valid || !prompt.trim()) return;
    onApply([
      {
        op: "replace_background",
        start,
        end,
        cutout: { model: cutout.id, seed: randomSeed() },
        background: { kind, model: scenery.id, prompt: prompt.trim(), seed: randomSeed() },
      },
    ]);
    onClose();
  };

  return (
    <div className="ed2-gen" data-testid="background-panel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="ed2-row">
        <strong>Replace the background behind you</strong>
        <span className="ed2-grow" />
        <button type="button" className="ed2-icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="ed2-muted">You stay as you are; the room behind you changes. Describe a place without people, text or logos.</p>
      <textarea
        className="ed2-asst-input"
        autoFocus
        rows={3}
        aria-label="New background"
        data-testid="background-prompt"
        placeholder="A bright modern office with plants, soft morning light"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="ed2-row">
        {(["image", "video"] as const).map((value) => (
          <button key={value} type="button" className="ed2-chip" aria-pressed={kind === value} data-testid={`background-kind-${value}`} onClick={() => setKind(value)}>
            {value === "image" ? "Still" : "Moving"}
          </button>
        ))}
        <span className="ed2-grow" />
        <label className="ed2-muted">
          From{" "}
          <input className="ed2-bg-time" type="number" step={0.1} min={0} value={start} data-testid="background-start" onChange={(event) => setStart(Number(event.target.value))} />
        </label>
        <label className="ed2-muted">
          to <input className="ed2-bg-time" type="number" step={0.1} min={0} value={end} data-testid="background-end" onChange={(event) => setEnd(Number(event.target.value))} /> s
        </label>
      </div>
      <div className="ed2-row">
        {!valid ? <span className="ed2-error">Pick up to {MAX_SWAP_SECONDS} seconds.</span> : null}
        <span className="ed2-grow" />
        <span className="ed2-muted" data-testid="background-price">
          {price === null ? "" : `${price} ${price === 1 ? "credit" : "credits"}`}
        </span>
        <button type="button" className="ed2-btn ed2-primary" data-testid="background-submit" disabled={!prompt.trim() || !valid || busy || !cutout || !scenery} onClick={submit}>
          Replace background
        </button>
      </div>
    </div>
  );
}
