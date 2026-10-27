import type { CSSProperties } from "react";

import type { NodeState } from "./model";

/** The 13×12 pixel robot of Main.dc.html, as path runs. Body, ink (antenna, arms, feet) and eyes are separate fills. */
const BODY = "M6 0h1v1h-1zM2 2h9v1h-9zM1 3h11v1h-11zM1 4h2v1h-2zM5 4h3v1h-3zM10 4h2v1h-2zM1 5h2v1h-2zM5 5h3v1h-3zM10 5h2v1h-2zM1 6h11v1h-11zM1 7h11v1h-11zM1 8h11v1h-11zM1 9h11v1h-11zM2 10h2v1h-2zM9 10h2v1h-2z";
const INK = "M6 1h1v1h-1zM0 7h1v1h-1zM12 7h1v1h-1zM0 8h1v1h-1zM12 8h1v1h-1zM2 11h2v1h-2zM9 11h2v1h-2z";
const EYES_OPEN = "M3 4h2v1h-2zM8 4h2v1h-2zM3 5h2v1h-2zM8 5h2v1h-2z";
/** Idle: eyes closed to one row. */
const EYES_SHUT = "M3 5h2v1h-2zM8 5h2v1h-2z";

const FILL: Record<NodeState | "hub", { body: string; ink: string; eyes: string }> = {
  hub: { body: "var(--v2-brand)", ink: "var(--v2-char-ink)", eyes: "var(--v2-char)" },
  working: { body: "var(--v2-brand)", ink: "var(--v2-ink)", eyes: "var(--v2-ink)" },
  idle: { body: "var(--v2-line2)", ink: "var(--v2-ink2)", eyes: "var(--v2-ink2)" },
  stuck: { body: "var(--v2-stuck)", ink: "var(--v2-ink)", eyes: "#ffffff" },
};

export function Robot({ state, delay = 0 }: { state: NodeState | "hub"; delay?: number }) {
  const fill = FILL[state];
  const motion = state === "stuck" ? "is-stuck" : state === "idle" ? "is-idle" : "is-working";
  return (
    <svg
      width="52"
      height="48"
      viewBox="0 0 13 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`v2-robot ${motion}`}
      style={{ "--v2-delay": `${delay}s`, "--v2-blink-delay": `${delay * 1.7}s` } as CSSProperties}
    >
      <path d={BODY} fill={fill.body} />
      <path d={INK} fill={fill.ink} />
      <path d={state === "idle" ? EYES_SHUT : EYES_OPEN} fill={fill.eyes} className={state === "idle" || state === "stuck" ? undefined : "v2-robot-eyes"} />
    </svg>
  );
}
