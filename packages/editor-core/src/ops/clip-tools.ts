/**
 * Clip tools learned from CapCut Web (plan 2026-11-15, session A): the cover frame (A2), and freeze, reverse and
 * speed curves (A3). Behaviour learned from the bundles; the code is ours.
 */

import { z } from 'zod';

import { FRAME_RATE as FPS, type ClipDocument, type ClipNode } from '@opencmo/clip-doc';

import { clone, copyOf, followsTranscript, type Entity } from '../doc';
import { OpFailure, type OpContext } from './context';
import { makeRoom } from './edit';
import { activeScene, nodeById, placeOf, splitElements, timesOf } from './timeline';

const seconds = (frames: number): number => Math.round((frames / FPS) * 1e4) / 1e4;

type SetCover = { time?: number; clear?: boolean };

/**
 * The frame a post shows before it plays (TikTok, Reels, Shorts): a time on the scene's timeline. The export writes
 * it as an image next to the MP4, and the schedule card uses it as the video's poster.
 */
export const setCover = {
  name: 'set_cover',
  input: z
    .object({ op: z.literal('set_cover'), time: z.number().finite().min(0).max(24 * 3600).optional(), clear: z.boolean().optional() })
    .refine((input) => input.clear || input.time !== undefined, 'Give a time, or clear the cover.'),
  describe: (input: SetCover) => (input.clear ? 'Clear the cover' : 'Set the cover frame'),
  async apply(document: ClipDocument, input: SetCover) {
    const next = clone(document);
    const scene = activeScene(next) as unknown as Entity;
    if (input.clear) {
      if (scene.cover === undefined) return document;
      delete scene.cover;
      return next;
    }
    const time = seconds(Math.round(input.time! * FPS));
    const workarea = scene.workarea as [number, number] | null | undefined;
    if (workarea && (time < workarea[0] || time >= workarea[1])) {
      throw new OpFailure(`The cover must be inside the part that is exported (${workarea[0]}–${workarea[1]} s).`);
    }
    if (scene.cover === time) return document;
    scene.cover = time;
    return next;
  },
};

// ------------------------------------------------------------------ freeze and speed ramp (A3)

const CLIP_SECONDS = z.number().finite().min(0).max(24 * 3600);
const ELEMENT = z.string().min(1).max(64);

/** A clip whose picture is a video: a video node, or a shape painted with one (how B-roll is inserted). */
function videoPaint(entity: Entity): { type: string; src?: unknown } | null {
  const paints = (entity.paints as { type: string; src?: unknown }[] | undefined) ?? [];
  return paints.find((paint) => paint.type === 'video') ?? null;
}
function isVideoClip(entity: Entity): boolean {
  return entity.kind === 'video' || videoPaint(entity) !== null;
}

function timedClip(document: ClipDocument, id: string, ctx: Pick<OpContext, 'media'>) {
  const entity = nodeById(document, id);
  if (!isVideoClip(entity)) throw new OpFailure('Pick a video clip.');
  if (followsTranscript(entity as unknown as ClipNode)) {
    throw new OpFailure("The clip's own video is timed by its transcript; do this on a B-roll clip.");
  }
  const t = timesOf(document, ctx).get(entity as unknown as ClipNode);
  if (!t) throw new OpFailure('That clip is not on the timeline.');
  return { entity, t };
}

type FreezeFrame = { element_id: string; at: number; seconds: number; src: string };

/**
 * Freeze frame (learned from CapCut Web: the frame at the playhead becomes a still that holds for a few seconds):
 * the clip is split at `at`, everything that starts from `at` moves later by `seconds`, and a still of the clip's
 * frame fills the gap in the clip's own place and size. `src` is that frame, already saved to the library (the
 * editor draws it; ops do no drawing).
 */
export const freezeFrame = {
  name: 'freeze_frame',
  input: z.object({
    op: z.literal('freeze_frame'),
    element_id: ELEMENT,
    at: CLIP_SECONDS,
    seconds: z.number().min(0.2).max(30),
    src: z.string().min(1).max(500),
  }),
  describe: (input: FreezeFrame) => `Freeze the frame for ${input.seconds}s`,
  async apply(document: ClipDocument, input: FreezeFrame, ctx: OpContext) {
    const { t } = timedClip(document, input.element_id, ctx);
    const frame = Math.round(input.at * FPS);
    if (!(t.start < frame && frame < t.end)) throw new OpFailure('Put the playhead inside the clip to freeze it.');
    let next = await splitElements.apply(document, { element_ids: [input.element_id], at: input.at }, ctx);
    next = await makeRoom.apply(next, { at: frame / FPS, seconds: input.seconds }, ctx);
    const piece = nodeById(next, input.element_id);
    const pieceTime = timesOf(next, ctx).get(piece as unknown as ClipNode);
    const parentOrigin = pieceTime?.parent?.origin ?? 0;
    const start = seconds(frame - parentOrigin);
    const still = copyOf(piece);
    for (const key of ['sourceIn', 'sourceOut', 'playbackRate', 'volume', 'muted', 'denoise', 'syncTo', 'transition', 'animations', 'tracks']) {
      delete still[key];
    }
    still.name = 'Freeze frame';
    still.start = start;
    still.end = seconds(frame - parentOrigin + Math.round(input.seconds * FPS));
    if (still.kind === 'video') {
      still.kind = 'image';
      still.src = input.src;
    } else {
      still.paints = ((still.paints as Entity[] | undefined) ?? []).map((paint) =>
        paint.type === 'video' ? { type: 'image', src: input.src, ...(paint.objectFit ? { objectFit: paint.objectFit } : {}) } : paint,
      );
    }
    const { list } = placeOf(next, piece);
    list.splice(list.indexOf(piece) + 1, 0, still);
    return next;
  },
};

/**
 * Speed ramps (learned from CapCut Web's curve-speed presets). The clip is cut into equal parts, each at its own
 * speed. Every preset averages exactly 1×, so the clip keeps its length on the timeline and uses the same footage:
 * nothing around it moves. Each part is a plain constant-speed clip, which the preview and the export already play
 * the same way (sound keeps its pitch).
 */
export const SPEED_RAMPS = {
  montage: [1.6, 1.6, 0.4, 0.4, 1, 1],
  hero: [1.5, 1.5, 0.25, 0.25, 1.25, 1.25],
  bullet: [1.75, 0.25, 0.25, 0.25, 1.75, 1.75],
  jump_cut: [0.5, 0.5, 2, 2, 0.5, 0.5],
  flash_in: [2, 1.5, 1, 0.75, 0.5, 0.25],
  flash_out: [0.25, 0.5, 0.75, 1, 1.5, 2],
} as const;
export type SpeedRamp = keyof typeof SPEED_RAMPS;
export const SPEED_RAMP_NAMES = Object.keys(SPEED_RAMPS) as [SpeedRamp, ...SpeedRamp[]];

type SpeedRampInput = { element_id: string; preset: SpeedRamp };

export const speedRamp = {
  name: 'speed_ramp',
  input: z.object({ op: z.literal('speed_ramp'), element_id: ELEMENT, preset: z.enum(SPEED_RAMP_NAMES) }),
  describe: (input: SpeedRampInput) => `Speed ramp: ${input.preset.replace('_', ' ')}`,
  async apply(document: ClipDocument, input: SpeedRampInput, ctx: OpContext) {
    const next = clone(document);
    const { entity, t } = timedClip(next, input.element_id, ctx);
    const rates = SPEED_RAMPS[input.preset];
    const length = t.end - t.start;
    if (length < rates.length * 3) throw new OpFailure('The clip is too short for a speed ramp (it needs at least 0.6 s).');
    const parentOrigin = t.parent?.origin ?? 0;
    const rate = t.rate || 1;
    // Where the clip's footage starts, in source frames: the renderer's `origin + sourceIn / rate` rule, read back.
    const sourceAt = (t.start - t.origin) * rate;
    const bounds = rates.map((_, i) => t.start + Math.round((i * length) / rates.length)).concat(t.end);
    let used = sourceAt;
    // Every part copies the clip as it was: the first part is the clip itself and is changed in place.
    const original = copyOf(entity);
    const pieces = rates.map((speed, i) => {
      const span = bounds[i + 1]! - bounds[i]!;
      const piece = i === 0 ? entity : copyOf(original);
      const from = used;
      used += span * rate * speed;
      piece.start = seconds(bounds[i]! - parentOrigin);
      piece.end = seconds(bounds[i + 1]! - parentOrigin);
      piece.sourceIn = seconds(from);
      piece.sourceOut = seconds(used);
      piece.playbackRate = Math.round(rate * speed * 1e4) / 1e4;
      // Entrances belong to the first part and exits to the last; keyframes and transitions would repeat in every part.
      const phases = new Set([...(i === 0 ? ['in'] : []), ...(i === rates.length - 1 ? ['out'] : [])]);
      const animations = ((original.animations as Entity[] | undefined) ?? []).map((animation) => structuredClone(animation)).filter((animation) => phases.has(String(animation.phase ?? 'in')));
      if (animations.length) piece.animations = animations;
      else delete piece.animations;
      if (i > 0) delete piece.transition;
      delete piece.tracks;
      return piece;
    });
    const { parent, list } = placeOf(next, entity);
    const at = list.indexOf(entity);
    if (parent.kind === 'scene') {
      // Parts side by side straight under the scene would read as six layers: a row keeps them one clip.
      list.splice(at, 1, { kind: 'sequence', name: 'Speed ramp', children: pieces });
    } else {
      list.splice(at, 1, ...pieces);
    }
    return next;
  },
};
