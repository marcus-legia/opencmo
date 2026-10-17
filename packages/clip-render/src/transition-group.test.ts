import { createCanvas } from '@napi-rs/canvas';
import { validate } from '@opencmo/clip-doc';
import { describe, expect, it } from 'vitest';

import { FPS, createRenderer, type MediaHost } from './index.ts';

const NO_MEDIA: MediaHost = { image: () => null, video: () => null, duration: () => null };

/**
 * A cut speaker inside a layout group (what `set_layout` makes): the sequence's own box is the
 * group's, which is not measured yet when the sequence is, so a transition that moves the shots
 * must measure the frame instead or it moves them by 0 px.
 */
/** `wide`: shots wider than the frame, slid under it, as a face-tracked crop of 16:9 footage is. */
function project(type: string, grouped: boolean, wide = false) {
  const box = wide ? { x: -100, width: 300, height: 100 } : { width: 100, height: 100 };
  const sequence = {
    kind: 'sequence',
    children: [
      { kind: 'rect', ...box, fill: '#FF0000', start: 0, end: 2, transition: { type, duration: 1 } },
      { kind: 'rect', ...box, fill: '#00FF00', start: 2, end: 4 },
    ],
  };
  return validate({
    version: 1,
    stage: { children: [{ kind: 'scene', name: 'S', width: 100, height: 100, fill: '#000000', active: true, children: [grouped ? { kind: 'group', name: 'Speaker', children: [sequence] } : sequence] }] },
  });
}

function colorsAt(type: string, grouped: boolean, seconds: number, wide = false): string[] {
  const renderer = createRenderer(project(type, grouped, wide), NO_MEDIA);
  const canvas = createCanvas(100, 100);
  renderer.render(canvas.getContext('2d') as never, Math.round(seconds * FPS));
  const ctx = canvas.getContext('2d');
  return [10, 90].map((x) => {
    const [r, g] = ctx.getImageData(x, 50, 1, 1).data;
    return r! > 128 ? 'red' : g! > 128 ? 'green' : 'other';
  });
}

describe('transitions that move the shots', () => {
  for (const type of ['whip', 'slideFromRight']) {
    it(`${type}: mid-way the outgoing shot is on the left and the incoming one on the right, grouped or not`, () => {
      const at = type === 'whip' ? 2.06 : 2;
      expect(colorsAt(type, false, at)).toEqual(['red', 'green']);
      expect(colorsAt(type, true, at)).toEqual(['red', 'green']);
      // A shot wider than the frame moves as the frame it shows, not as its whole box.
      expect(colorsAt(type, true, at, true)).toEqual(['red', 'green']);
    });
  }

  it('fadeToBlack darkens the whole frame inside a group too', () => {
    const renderer = createRenderer(project('fadeToBlack', true), NO_MEDIA);
    const canvas = createCanvas(100, 100);
    renderer.render(canvas.getContext('2d') as never, Math.round(2 * FPS) - 1);
    const [r] = canvas.getContext('2d').getImageData(50, 50, 1, 1).data;
    expect(r!).toBeLessThan(40);
  });
});
