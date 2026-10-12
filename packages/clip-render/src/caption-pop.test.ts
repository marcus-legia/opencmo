import { createCanvas } from '@napi-rs/canvas';
import { validate } from '@opencmo/clip-doc';
import { describe, expect, it } from 'vitest';

import { createRenderer, type MediaHost } from './index.ts';

const words = (list: [string, number, number][]) => list.map(([text, start, end]) => ({ text, start, end }));

/** Ink columns of a frame (any channel bright), left to right, as runs `[x0, x1]`. */
function inkRuns(seconds: number, highlight?: 'pop'): [number, number][] {
  const transcript = [{ words: words([['hundred', 0, 0.4], ['thousand', 0.4, 0.8]]) }];
  const media: MediaHost = { image: () => null, video: () => null, duration: () => null, transcript: () => transcript };
  const document = validate({
    version: 1,
    stage: {
      children: [
        {
          kind: 'scene',
          name: 'S',
          width: 1080,
          height: 1920,
          fill: '#000000',
          active: true,
          children: [{ kind: 'captions', src: 't.json', preset: 'classic', maxWords: 2, fontScale: 1.5, ...(highlight ? { highlight } : {}) }],
        },
      ],
    },
  });
  const renderer = createRenderer(document, media);
  const canvas = createCanvas(1080, 1920);
  renderer.render(canvas.getContext('2d') as never, renderer.exportFrame(seconds));
  const { data } = canvas.getContext('2d').getImageData(0, 0, 1080, 1920);
  const runs: [number, number][] = [];
  for (let x = 0; x < 1080; x++) {
    let ink = false;
    for (let y = 0; y < 1920 && !ink; y++) {
      const at = (y * 1080 + x) * 4;
      ink = data[at]! > 100 || data[at + 1]! > 100 || data[at + 2]! > 100;
    }
    const last = runs.at(-1);
    if (ink && last && last[1] === x - 1) last[1] = x;
    else if (ink) runs.push([x, x]);
  }
  return runs;
}

describe('caption highlight pop', () => {
  it('the grown word does not run into the next one', () => {
    const plain = inkRuns(0.2);
    const popped = inkRuns(0.2, 'pop');
    // The widest gap between two ink runs is the space between the words.
    const space = (runs: [number, number][]) => Math.max(...runs.slice(1).map((run, i) => run[0] - runs[i]![1] - 1));
    expect(space(plain)).toBeGreaterThan(10);
    expect(space(popped)).toBeGreaterThan(space(plain) * 0.6);
  });
});
