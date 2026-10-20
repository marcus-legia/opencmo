"use client";

/**
 * The timeline under the full-size picker: one box per picked moment, two handles each.
 *
 * Dragging a handle seeks the player there, so the user sees the exact frame a clip starts or ends
 * on; the old picker was dropped on 2026-10-04 and this is its replacement (plan item 1). Every
 * change goes through `moveEdge`, so a drag can never produce moments the server refuses.
 * Handles are sliders for the keyboard too: arrows move 0.5 s, Shift 5 s.
 */

import { useRef } from "react";

import { clock, moveEdge, type Segment } from "@/lib/clipping/segments";

type Props = {
  duration: number;
  time: number;
  segments: Segment[];
  /** `I` was pressed here and `O` not yet. */
  mark: number | null;
  disabled?: boolean;
  onChange: (segments: Segment[]) => void;
  onSeek: (seconds: number) => void;
};

const pct = (value: number, duration: number) => `${(Math.min(Math.max(value, 0), duration) / duration) * 100}%`;

export function SegmentBar({ duration, time, segments, mark, disabled, onChange, onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const ready = duration > 0;

  const at = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !box.width) return 0;
    return ((clientX - box.left) / box.width) * duration;
  };

  function drag(index: number, edge: "start" | "end", event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || !ready) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let latest = segments;
    const move = (next: PointerEvent) => {
      latest = moveEdge(latest, index, edge, at(next.clientX), duration);
      onChange(latest);
      onSeek(latest[index]![edge]);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function nudge(index: number, edge: "start" | "end", event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 5 : 0.5;
    const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    if (!delta || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const next = moveEdge(segments, index, edge, segments[index]![edge] + delta, duration);
    onChange(next);
    onSeek(next[index]![edge]);
  }

  return (
    <div className="clip-picker-bar" data-testid="picker-bar" aria-label="Moments on the video timeline">
      <div
        ref={track}
        className="clip-picker-track"
        onPointerDown={(event) => {
          if (ready && event.button === 0) onSeek(at(event.clientX));
        }}
      >
        {ready
          ? segments.map((segment, index) => (
              <div
                key={`${index}-${segment.start}`}
                className="clip-picker-moment"
                style={{ left: pct(segment.start, duration), width: `calc(${pct(segment.end, duration)} - ${pct(segment.start, duration)})` }}
                data-testid="picker-moment"
              >
                <span className="clip-picker-moment-label">{index + 1}</span>
                {(["start", "end"] as const).map((edge) => (
                  <button
                    key={edge}
                    type="button"
                    role="slider"
                    className={`clip-picker-handle is-${edge}`}
                    aria-label={`${edge === "start" ? "Start" : "End"} of moment ${index + 1}`}
                    aria-valuemin={0}
                    aria-valuemax={Math.round(duration)}
                    aria-valuenow={Math.round(segment[edge] * 10) / 10}
                    aria-valuetext={clock(segment[edge])}
                    disabled={disabled}
                    data-testid={`picker-handle-${edge}`}
                    onPointerDown={(event) => drag(index, edge, event)}
                    onKeyDown={(event) => nudge(index, edge, event)}
                  />
                ))}
              </div>
            ))
          : null}
        {ready && mark !== null ? <span className="clip-picker-mark" style={{ left: pct(mark, duration) }} aria-hidden="true" /> : null}
        {ready ? <span className="clip-picker-playhead" style={{ left: pct(time, duration) }} aria-hidden="true" /> : null}
      </div>
      <div className="clip-picker-scale" aria-hidden="true">
        <span>0:00</span>
        <span>{ready ? clock(duration).replace(/\.\d$/, "") : "–"}</span>
      </div>
    </div>
  );
}
