/**
 * Clip tools learned from CapCut Web (plan 2026-11-15, session A): the cover frame (A2), and freeze, reverse and
 * speed curves (A3). Behaviour learned from the bundles; the code is ours.
 */

import { z } from 'zod';

import { FRAME_RATE as FPS, type ClipDocument } from '@opencmo/clip-doc';

import { clone, type Entity } from '../doc';
import { OpFailure } from './context';
import { activeScene } from './timeline';

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
