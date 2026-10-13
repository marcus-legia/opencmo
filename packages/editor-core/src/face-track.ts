/**
 * Face-tracking `x` keyframes of one cut segment.
 *
 * The scene's `reframe` mark holds the whole track. Every cut segment used to carry a full copy of
 * it, so a ten-minute clip cut by `remove_silence` (119 segments × 41 keys) outgrew the save limit.
 * A segment keeps only the keys around its own source range; keys a trimmed template lacks (words
 * restored, a segment that grew) come back from the mark.
 */
import { xForFocus } from './reframe';
import { round } from './transcript';

export type FaceFrame = { track: [number, number][]; frameWidth: number };
export type XKey = { time: number; value: number; easing?: string };

const EPSILON = 1e-3;

/**
 * The `x` keys a segment showing `range` (source seconds) needs: the mark's keys inside the range,
 * plus the one before and the one after so both ends interpolate as the full track did. A key the
 * template already has keeps its value. Null when the template holds a key the mark does not: that
 * key is the user's own, and the track is left as it is.
 */
export function faceXTrack(keys: XKey[], face: FaceFrame, range: { start: number; end: number }, boxWidth: number): XKey[] | null {
  const times = face.track.map(([time]) => time);
  if (keys.some((key) => !times.some((time) => Math.abs(time - key.time) < EPSILON))) return null;
  let first = 0;
  for (let index = 0; index < times.length; index++) if (times[index]! <= range.start + EPSILON) first = index;
  let last = times.findIndex((time) => time >= range.end - EPSILON);
  if (last < first) last = last < 0 ? times.length - 1 : first;
  return face.track.slice(first, last + 1).map(([time, focus]) => {
    const kept = keys.find((key) => Math.abs(key.time - time) < EPSILON);
    return kept ?? { time: round(time), value: xForFocus(focus, boxWidth, face.frameWidth), easing: 'easeInOut' };
  });
}
