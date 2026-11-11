import type { ScriptBeat } from "./writer/types";

export const SHOT_LABEL: Record<ScriptBeat["shot"], string> = { talking_head: "To camera", screen: "Screen", broll: "You film" };

/**
 * A script's beats as timeline markers (owner, 2026-11-09): one per beat at its time, with what to say and what to
 * show. The name is the beat's key, so a beat placed already is not placed again.
 */
export function scriptMarkers(beats: readonly ScriptBeat[]) {
  let at = 0;
  return beats.map((beat, index) => {
    const op = { op: "set_marker" as const, time: at, duration: beat.seconds, name: `${String(index + 1).padStart(2, "0")} · ${SHOT_LABEL[beat.shot]}`, comment: `Say: ${beat.say}\nShow: ${beat.show}` };
    at += beat.seconds;
    return op;
  });
}
