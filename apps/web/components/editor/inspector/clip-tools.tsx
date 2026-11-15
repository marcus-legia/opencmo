"use client";

/**
 * Clip tools for a B-roll video clip (plan 2026-11-15 A3, learned from CapCut Web's timeline toolbar): freeze the
 * frame at the playhead, and speed ramp presets. Both are ops (`freeze_frame`, `speed_ramp`); the freeze also needs
 * the frame drawn and saved first, which the editor does (`freeze`).
 */

import { useState } from "react";

import type { ClipNode } from "@opencmo/clip-doc";
import { followsTranscript, SPEED_RAMP_NAMES, type SpeedRamp } from "@opencmo/editor-core";

import { Row, Section, SelectField } from "./controls";
import type { InspectorContext } from "./shared";

const RAMP_LABEL: Record<SpeedRamp, string> = {
  montage: "Montage",
  hero: "Hero (slow in the middle)",
  bullet: "Bullet time",
  jump_cut: "Jump cut",
  flash_in: "Flash in",
  flash_out: "Flash out",
};

/** A clip whose picture is a video and that is not the clip's own transcript-timed video. */
export function isFreezable(node: Record<string, unknown>): boolean {
  const video = node.kind === "video" || ((node.paints as { type?: string }[] | undefined) ?? []).some((paint) => paint.type === "video");
  return video && !followsTranscript(node as unknown as ClipNode);
}

export function ClipToolsSection({ ctx, freeze }: { ctx: InspectorContext; freeze?: (id: string, seconds: number) => Promise<void> }) {
  const [ramp, setRamp] = useState<SpeedRamp>("montage");
  const [seconds, setSeconds] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = typeof ctx.node.id === "string" ? ctx.node.id : null;
  const inside = ctx.time && typeof ctx.frame === "number" ? ctx.time.start < ctx.frame && ctx.frame < ctx.time.end : false;
  if (!id) return null;

  const doFreeze = async () => {
    if (!freeze) return;
    setBusy(true);
    setError(null);
    try {
      await freeze(id, seconds);
    } catch (failure) {
      setError((failure as Error).message || "The frame could not be frozen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Clip tools" testid="ins-clip-tools">
      {freeze ? (
        <Row label="Freeze">
          <select className="ed2-select" aria-label="Freeze length" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
            {[1, 2, 3, 5].map((value) => (
              <option key={value} value={value}>
                {value} s
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ed2-btn"
            data-testid="ins-freeze"
            disabled={busy || !inside}
            title={inside ? "Hold the frame at the playhead" : "Put the playhead inside this clip"}
            onClick={() => void doFreeze()}
          >
            {busy ? "Freezing…" : "Freeze frame"}
          </button>
        </Row>
      ) : null}
      <Row label="Speed ramp">
        <SelectField value={ramp} options={SPEED_RAMP_NAMES.map((value) => ({ value, label: RAMP_LABEL[value] }))} onChange={setRamp} label="Speed ramp preset" testid="ins-ramp-preset" />
        <button type="button" className="ed2-btn" data-testid="ins-ramp-apply" onClick={() => ctx.edit([{ op: "speed_ramp", element_id: id, preset: ramp }])}>
          Apply
        </button>
      </Row>
      {error ? <p className="ed2-clips-error" role="alert">{error}</p> : null}
    </Section>
  );
}
