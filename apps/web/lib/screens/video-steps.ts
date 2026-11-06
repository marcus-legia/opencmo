/**
 * The Video team's progress on one `build_video` order, as lines (Studio's team panel, a video order on Brain).
 * Read from the order's `studio_steps` and its state, so it says what really happened: the founder approved the
 * one price for the whole video, its keyframes, shots, voice-over and music are being made, card 3 waits.
 *
 * Pure (no server-only): `screens.check.ts` runs it.
 */

import type { TeamStep } from "./studio";

export type VideoStepRow = {
  tool: string;
  kind: "script" | "price";
  status: "waiting" | "approved" | "running" | "done" | "cancelled" | "failed";
  decision: string | null;
  card: { beats?: unknown[]; shots?: number } | null;
  next: { tool?: string } | null;
  next_done_at: string | null;
};

type OrderState = "queued" | "running" | "waiting_founder" | "waiting_order" | "deferred" | "done" | "failed" | "cancelled";

const state = (done: boolean, running: boolean): TeamStep["state"] => (done ? "done" : running ? "running" : "todo");

export function videoSteps(order: { status: OrderState }, rows: VideoStepRow[], card3Waiting: boolean): TeamStep[] {
  const live = rows.filter((r) => r.status !== "cancelled");
  const script = live.filter((r) => r.kind === "script").at(-1);
  const beats = Array.isArray(script?.card?.beats) ? script.card.beats.length : 0;
  const scriptOk = !!script && script.status !== "waiting" && script.decision === "approve";
  // One approval starts every piece; the step is done once the render it waits on could start.
  const made = scriptOk && (script.status === "done" || !!script.next_done_at);
  const finished = order.status === "done";
  const lines: TeamStep[] = [
    { label: "Brief from the week plan", state: "done" },
    { label: script ? `Director: ${beats} ${beats === 1 ? "beat" : "beats"}` : "Director writes the script", state: state(!!script, order.status === "running" && !script) },
    { label: scriptOk ? "Storyboard · you approved the video price" : "Storyboard · waits on you", state: state(scriptOk, !!script && !scriptOk) },
    { label: "Keyframes, shots, voice-over and music", state: state(made, scriptOk && !made) },
    { label: "Render → finished video card", state: state(finished, made && !finished && (card3Waiting || order.status === "waiting_order")) },
  ];
  return lines.map((s) => ({ ...s, label: s.label.slice(0, 80) }));
}
