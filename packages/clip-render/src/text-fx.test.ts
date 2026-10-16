import { createCanvas } from '@napi-rs/canvas';
import { validate } from '@opencmo/clip-doc';
import { describe, expect, it } from 'vitest';

import { captionFrame } from './captions.ts';
import { evaluate } from './frame.ts';
import { createRenderer, type MediaHost } from './index.ts';
import { lineMasks, revealChars, scramble } from './text.ts';
import { buildTree } from './tree.ts';
import { graphemes, hashSeed, unitProgress, unitRanks } from './units.ts';

const NO_MEDIA: MediaHost = { image: () => null, video: () => null, duration: () => null };

type Fx = Record<string, unknown>;

const project = (animation: Fx) =>
  validate({
    version: 1,
    stage: {
      children: [
        {
          kind: 'scene',
          name: 'S',
          width: 400,
          height: 100,
          fill: '#000000',
          active: true,
          children: [
            { kind: 'text', x: 10, y: 20, end: 4, text: 'AAAA BBBB', color: '#FFFFFF', fontSize: 48, animations: [animation] },
          ],
        },
      ],
    },
  });

/** Đếm điểm ảnh trắng / đỏ ở nửa trái và nửa phải của chữ (cột chia ở giữa hai từ). */
function halves(animation: Fx, frame: number) {
  const document = project(animation);
  const renderer = createRenderer(document, NO_MEDIA);
  const canvas = createCanvas(400, 100);
  renderer.render(canvas.getContext('2d') as never, frame);
  const data = canvas.getContext('2d').getImageData(0, 0, 400, 100).data;
  // Bề ngang "AAAA " để biết cột chia.
  const ctx = createCanvas(10, 10).getContext('2d');
  ctx.font = '48px Inter';
  const split = 10 + ctx.measureText('AAAA ').width - 4;
  const count = { leftWhite: 0, rightWhite: 0, leftRed: 0, rightRed: 0 };
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 400; x++) {
      const p = (y * 400 + x) * 4;
      const [r, g, b] = [data[p]!, data[p + 1]!, data[p + 2]!];
      // Bỏ dải 16 px quanh cột chia: từ đang phóng 1.15 tràn sang một chút.
      if (Math.abs(x - split) < 16) continue;
      const side = x < split ? 'left' : 'right';
      if (r > 200 && g > 200 && b > 200) count[`${side}White`]++;
      if (r > 200 && g < 80 && b < 80) count[`${side}Red`]++;
    }
  }
  return count;
}

describe('animation chữ theo từ (E4)', () => {
  it('wordSlide: từ hiện lần lượt theo perWord', () => {
    const fx = { type: 'wordSlide', perWord: 1 };
    const start = halves(fx, 0);
    expect(start.leftWhite + start.rightWhite).toBeLessThan(20);
    // perWord 1 s = 30 khung, mỗi từ trượt trong 60 khung. Khung 45: từ 1 gần xong (98%), từ 2 mới 25% (còn mờ).
    const mid = halves(fx, 45);
    expect(mid.leftWhite).toBeGreaterThan(200);
    expect(mid.rightWhite).toBeLessThan(mid.leftWhite / 3);
    const end = halves(fx, 119);
    expect(end.rightWhite).toBeGreaterThan(200);
  });

  it('highlightPop: từ đang tới màu nhấn, từ khác giữ màu chữ; hết lượt thì về màu thường', () => {
    const fx = { type: 'highlightPop', perWord: 0.5, color: '#FF0000' };
    const first = halves(fx, 5);
    expect(first.leftRed).toBeGreaterThan(200);
    expect(first.rightWhite).toBeGreaterThan(200);
    expect(first.rightRed).toBe(0);
    const second = halves(fx, 20);
    expect(second.rightRed).toBeGreaterThan(200);
    expect(second.leftWhite).toBeGreaterThan(200);
    const done = halves(fx, 40);
    expect(done.leftRed + done.rightRed).toBe(0);
  });

  it('typewriter: hiện dần ký tự, có con trỏ khi đang gõ, đủ chữ khi xong', () => {
    const document = project({ type: 'typewriter', duration: 1 });
    const root = buildTree(document.stage.children[0] as never, NO_MEDIA);
    evaluate(root, 15, [1, 0, 0, 1, 0, 0]);
    const text = root.children[0]!;
    expect(text.chars!.endsWith('|')).toBe(true);
    expect(text.chars!.length).toBeLessThan('AAAA BBBB'.length + 1);
    evaluate(root, 45, [1, 0, 0, 1, 0, 0]);
    expect(root.children[0]!.chars).toBeNull();
  });
});

describe('phụ đề highlight pop (E4)', () => {
  it('từ đang nói có range màu nhấn và phóng sau 0.08 s', () => {
    const group = [
      { text: 'hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 1 },
    ];
    const frame = captionFrame({ kind: 'captions', src: 'x.json', preset: 'classic', highlight: 'pop' } as never, [group], 0.7, 0);
    expect(frame.pop).toBeDefined();
    expect(frame.pop!.scale).toBeCloseTo(1.15, 5);
    expect(frame.text.slice(frame.pop!.range.start, frame.pop!.range.end)).toBe('world');
  });
});

describe('kiểu chữ (E4-b/c)', () => {
  const scene = (body: Record<string, unknown>[], fill = '#000000') =>
    validate({
      version: 1,
      stage: { children: [{ kind: 'scene', name: 'S', width: 300, height: 120, fill, active: true, children: body }] },
    });
  const render = (body: Record<string, unknown>[], fill?: string, edit?: (doc: ReturnType<typeof scene>) => void) => {
    const document = scene(body, fill);
    edit?.(document);
    const renderer = createRenderer(document, { ...NO_MEDIA, canvas: (w, h) => createCanvas(w, h) });
    const canvas = createCanvas(300, 120);
    renderer.render(canvas.getContext('2d') as never, 0);
    const ctx = canvas.getContext('2d');
    return (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  };
  const textNode = (doc: ReturnType<typeof scene>) => (doc.stage.children[0] as unknown as { children: Record<string, unknown>[] }).children.at(-1)!;

  it('hộp nền bao chữ có padding; ngoài hộp vẫn là nền scene', () => {
    const at = render([{ kind: 'text', x: 60, y: 40, text: 'Hi', color: '#FFFFFF', fontSize: 30 }], '#000000', (doc) => {
      textNode(doc).background = { color: '#0000FF', paddingX: 20, paddingY: 10, radius: 4 };
    });
    expect(at(45, 50)).toEqual([0, 0, 255]);
    expect(at(10, 10)).toEqual([0, 0, 0]);
  });

  it('gạch dưới nằm dưới chữ, theo bề rộng dòng', () => {
    const without = render([{ kind: 'text', x: 20, y: 20, text: 'HELLO', color: '#FFFFFF', fontSize: 40 }]);
    const withLine = render([{ kind: 'text', x: 20, y: 20, text: 'HELLO', color: '#FFFFFF', fontSize: 40 }], '#000000', (doc) => {
      textNode(doc).decoration = ['underline'];
    });
    let added = 0;
    for (let y = 40; y < 80; y++) if (withLine(60, y)[0]! > 200 && without(60, y)[0]! < 50) added++;
    expect(added).toBeGreaterThan(0);
  });

  it('footage: trong lòng chữ thấy lớp dưới, ngoài chữ phủ màu chữ', () => {
    const body = [
      { kind: 'rect', width: 300, height: 120, fill: '#FF0000' },
      { kind: 'text', x: 10, y: 10, text: 'II', color: '#000000', fontSize: 100, fontWeight: 900 },
    ];
    const at = render(body, '#000000', (doc) => {
      textNode(doc).fill = 'footage';
    });
    // Góc khung: phủ đen (màu chữ). Giữa nét chữ "I" đầu: thấy đỏ của rect.
    expect(at(290, 110)).toEqual([0, 0, 0]);
    let red = 0;
    for (let x = 10; x < 60; x++) if (at(x, 60)[0]! > 200) red++;
    expect(red).toBeGreaterThan(5);
  });

  it('inverted: chữ trắng trên nền trắng thành đen (difference)', () => {
    const at = render([
      { kind: 'rect', width: 300, height: 120, fill: '#FFFFFF' },
      { kind: 'text', x: 10, y: 10, text: 'II', color: '#FFFFFF', fontSize: 100, fontWeight: 900 },
    ], '#FFFFFF', (doc) => {
      textNode(doc).fill = 'inverted';
    });
    let black = 0;
    for (let x = 10; x < 60; x++) if (at(x, 60)[0]! < 50) black++;
    expect(black).toBeGreaterThan(5);
  });

  it('tiltY co bề ngang chữ', () => {
    const width = (tilt: number) => {
      const document = scene([{ kind: 'text', x: 20, y: 20, text: 'WIDE TEXT', color: '#FFFFFF', fontSize: 40 }]);
      textNode(document).tiltY = tilt;
      const renderer = createRenderer(document, NO_MEDIA);
      const canvas = createCanvas(300, 120);
      renderer.render(canvas.getContext('2d') as never, 0);
      const data = canvas.getContext('2d').getImageData(0, 0, 300, 120).data;
      let min = 300;
      let max = 0;
      for (let y = 0; y < 120; y++) for (let x = 0; x < 300; x++) if (data[(y * 300 + x) * 4]! > 128) (min = Math.min(min, x)), (max = Math.max(max, x));
      return max - min;
    };
    expect(width(60)).toBeLessThan(width(0) * 0.7);
  });
});

describe('unit helpers (graphemes, ranks, progress)', () => {
  it('keeps emoji with skin tone and decomposed marks whole', () => {
    expect(graphemes('Xin chào 👋🏽')).toEqual(['X', 'i', 'n', ' ', 'c', 'h', 'à', 'o', ' ', '👋🏽']);
    const nfd = 'Nguyễn'.normalize('NFD');
    expect(graphemes(nfd)).toHaveLength(6);
    expect(graphemes(nfd).join('')).toBe(nfd);
  });

  it('ranks units for each order', () => {
    expect(unitRanks(5, 'first', 0)).toEqual([0, 1, 2, 3, 4]);
    expect(unitRanks(5, 'last', 0)).toEqual([4, 3, 2, 1, 0]);
    expect(unitRanks(5, 'center', 0)).toEqual([2, 1, 0, 1, 2]);
    expect(unitRanks(4, 'center', 0)).toEqual([1, 0, 0, 1]);
    expect(unitRanks(0, 'random', 1)).toEqual([]);
  });

  it('shuffles random order deterministically by seed', () => {
    const seed = hashSeed('node-1');
    const a = unitRanks(12, 'random', seed);
    expect(unitRanks(12, 'random', seed)).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual([...Array(12).keys()]);
    expect(a).not.toEqual([...Array(12).keys()]);
    expect(unitRanks(12, 'random', hashSeed('node-2'))).not.toEqual(a);
  });

  it('progresses each unit after its rank × step', () => {
    expect(unitProgress(0, 0, 0.1, 0.5)).toBe(0);
    expect(unitProgress(0.25, 0, 0.1, 0.5)).toBeCloseTo(0.5);
    expect(unitProgress(0.25, 2, 0.1, 0.5)).toBeCloseTo(0.1);
    expect(unitProgress(0.1, 3, 0.1, 0.5)).toBe(0);
    expect(unitProgress(9, 3, 0.1, 0.5)).toBe(1);
  });
});

describe('grapheme-safe appearChar / typewriter / scramble (A2)', () => {
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const ratios = Array.from({ length: 101 }, (_, index) => index / 100);

  it('never shows half an emoji', () => {
    for (const ratio of ratios) {
      expect(revealChars('Xin chào 👋🏽', ratio)).not.toMatch(loneSurrogate);
      expect(scramble('Xin chào 👋🏽', ratio)).not.toMatch(loneSurrogate);
    }
    // Skin tone stays with its hand: the last grapheme appears in one piece.
    expect(revealChars('Xin chào 👋🏽', 0.95)).toBe('Xin chào ');
  });

  it('never shows a decomposed Vietnamese letter before its marks', () => {
    const nfd = 'Nguyễn Thị Hương'.normalize('NFD');
    for (const ratio of ratios) {
      const shown = revealChars(nfd, ratio);
      expect(nfd.startsWith(shown)).toBe(true);
      // The next code point after the visible prefix is never a combining mark of the last letter.
      expect(/^\p{M}/u.test(nfd.slice(shown.length))).toBe(false);
    }
  });

  it('typewriter cuts by grapheme too', () => {
    const doc = validate({
      version: 1,
      stage: {
        children: [
          {
            kind: 'scene',
            name: 'S',
            width: 400,
            height: 100,
            active: true,
            children: [{ kind: 'text', end: 4, text: '👋🏽👋🏽', animations: [{ type: 'typewriter', duration: 1 }] }],
          },
        ],
      },
    });
    const root = buildTree(doc.stage.children[0] as never, NO_MEDIA);
    for (let frame = 0; frame < 30; frame++) {
      evaluate(root, frame, [1, 0, 0, 1, 0, 0]);
      const text = root.children[0]!.chars ?? '';
      expect(text).not.toMatch(loneSurrogate);
    }
  });

  // The scramble before graphemes, kept to prove ASCII output did not move (anim-scramble).
  function legacyScramble(text: string, ratio: number): string {
    const set = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!%#_';
    if (!text.length) return '';
    if (ratio >= 1) return text;
    const step = Math.floor(ratio * 30);
    let seed = 0;
    for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    let out = '';
    for (let index = 0; index < text.length; index++) {
      const settle = Math.ceil(((index * 0.7) / text.length + 0.3) * 30) / 30;
      if (ratio >= settle || text[index] === ' ') {
        out += text[index];
        continue;
      }
      let h = (seed + index * 7919 + step * 104729) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
      out += set[((h ^ (h >>> 16)) >>> 0) % set.length];
    }
    return out;
  }

  it('scrambles ASCII exactly as before', () => {
    for (const text of ['Words appear one by one', 'OpenCMO 2026!', 'a']) {
      for (const ratio of ratios) expect(scramble(text, ratio)).toBe(legacyScramble(text, ratio));
    }
  });
});

describe('unit animator (A3)', () => {
  const W = 600;
  const H = 160;
  const doc = (nodes: Record<string, unknown>[]) =>
    validate({
      version: 1,
      stage: { children: [{ kind: 'scene', name: 'S', width: W, height: H, fill: '#000000', active: true, children: nodes }] },
    });
  const pixels = (nodes: Record<string, unknown>[], frame: number) => {
    const renderer = createRenderer(doc(nodes), NO_MEDIA);
    const canvas = createCanvas(W, H);
    renderer.render(canvas.getContext('2d') as never, frame);
    return canvas.getContext('2d').getImageData(0, 0, W, H).data;
  };
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
  /** White ink per third of the text's own width at rest ([20, 20 + width of the line]), left to right. */
  const thirds = (data: Uint8ClampedArray) => {
    const ctx = createCanvas(10, 10).getContext('2d');
    ctx.font = '48px Inter';
    const span = ctx.measureText('AAAA BBBB CCCC').width;
    const out = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4]! > 128) out[Math.max(0, Math.min(2, Math.floor(((x - 20) * 3) / span)))]!++;
      }
    }
    return out;
  };
  const words = (animation: Record<string, unknown>, extra: Record<string, unknown> = {}) => [
    { kind: 'text', id: 't', x: 20, y: 40, end: 4, text: 'AAAA BBBB CCCC', color: '#FFFFFF', fontSize: 48, animations: [animation], ...extra },
  ];
  const evaluateAt = (nodes: Record<string, unknown>[], frame: number) => {
    const root = buildTree(doc(nodes).stage.children[0] as never, NO_MEDIA);
    evaluate(root, frame, [1, 0, 0, 1, 0, 0]);
    return root.children[0]!;
  };

  it('slideUp + unit word with step = perWord draws what wordSlide draws', () => {
    // wordSlide: 6-frame steps, 12 frames per word. Same window for both: 6 × 2 + 12 = 24 frames.
    const legacy = { type: 'wordSlide', perWord: 0.2, duration: 0.8 };
    const unit = { type: 'slideUp', unit: 'word', step: 0.2, duration: 0.8 };
    for (const frame of [3, 9, 16]) {
      const a = pixels(words(legacy), frame);
      const b = pixels(words(unit), frame);
      let diff = 0;
      for (let index = 0; index < a.length; index++) diff = Math.max(diff, Math.abs(a[index]! - b[index]!));
      expect(diff, `frame ${frame}`).toBe(0);
    }
  });

  it('first order reveals left to right, last right to left, center from the middle', () => {
    const first = thirds(pixels(words({ type: 'fade', unit: 'char', order: 'first', duration: 1 }), 10));
    expect(first[0]).toBeGreaterThan(first[2]! * 2);
    const last = thirds(pixels(words({ type: 'fade', unit: 'char', order: 'last', duration: 1 }), 10));
    expect(last[2]).toBeGreaterThan(last[0]! * 2);
    const center = thirds(pixels(words({ type: 'fade', unit: 'word', order: 'center', step: 0.3, duration: 1 }), 8));
    expect(center[1]).toBeGreaterThan(center[0]! * 2);
    expect(center[1]).toBeGreaterThan(center[2]! * 2);
  });

  it('random order draws the same frame twice and differs from first', () => {
    const random = { type: 'pop', unit: 'char', order: 'random', duration: 1 };
    expect(same(pixels(words(random), 9), pixels(words(random), 9))).toBe(true);
    expect(same(pixels(words(random), 9), pixels(words({ ...random, order: 'first' }), 9))).toBe(false);
  });

  it('every unit type reaches the text at rest, out empties it', () => {
    const rest = pixels(words({ type: 'fade', duration: 0.1 }), 30);
    for (const type of ['fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'pop', 'blur', 'grow']) {
      for (const unit of ['char', 'word', 'line']) {
        const done = pixels(words({ type, unit, duration: 1 }), 60);
        expect(same(done, rest), `${type} ${unit}`).toBe(true);
        // Last frame of an out animation: nothing left (grow/blur keep the text visible, as at node level).
        const gone = thirds(pixels(words({ type, unit, phase: 'out', duration: 1 }), 119));
        if (type !== 'grow' && type !== 'blur') expect(gone[0]! + gone[1]! + gone[2]!, `${type} ${unit} out`).toBe(0);
      }
    }
  });

  it('blur runs per unit through ctx.filter on Node too (@napi-rs/canvas has it; no alpha fallback needed)', () => {
    expect('filter' in createCanvas(1, 1).getContext('2d')).toBe(true);
    const mid = pixels(words({ type: 'blur', unit: 'word', order: 'last', step: 0.3, duration: 1 }), 14);
    // Last word settled (sharp), first word still blurred: soft grey pixels only on the left.
    const grey = [0, 0, 0];
    const ctx = createCanvas(10, 10).getContext('2d');
    ctx.font = '48px Inter';
    const span = ctx.measureText('AAAA BBBB CCCC').width;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = mid[(y * W + x) * 4]!;
        if (v > 20 && v < 100) grey[Math.max(0, Math.min(2, Math.floor(((x - 20) * 3) / span)))]!++;
      }
    }
    expect(grey[0]).toBeGreaterThan(grey[2]! * 3);
  });

  it('defaults: step per unit, duration from the unit count, 200-letter cap', () => {
    const fx = evaluateAt(words({ type: 'fade', unit: 'char' }), 0).unitFx!;
    expect(fx.step).toBeCloseTo(0.03 * 30);
    // 12 letters: 0.5 + 0.03 × 11 = 0.83 s.
    expect(fx.total).toBe(Math.round(0.83 * 30));
    expect(evaluateAt(words({ type: 'fade', unit: 'line' }), 0).unitFx!.total).toBe(27);
    const long = evaluateAt(words({ type: 'fade', unit: 'char' }, { text: 'word '.repeat(60) }), 0).unitFx!;
    expect(long.unit).toBe('word');
    expect(long.step).toBeCloseTo(0.055 * 30);
  });

  it('captions ignore unit and run the animation on the node', () => {
    const root = buildTree(
      validate({
        version: 1,
        stage: {
          children: [
            {
              kind: 'scene',
              name: 'S',
              width: 400,
              height: 400,
              active: true,
              children: [{ kind: 'captions', src: 'x.json', end: 4, animations: [{ type: 'fade', unit: 'word', duration: 1 }] }],
            },
          ],
        },
      }).stage.children[0] as never,
      NO_MEDIA,
    );
    evaluate(root, 10, [1, 0, 0, 1, 0, 0]);
    const captions = root.children[0]!;
    expect(captions.unitFx).toBeNull();
    expect(captions.values.opacity).toBeGreaterThan(0);
    expect(captions.values.opacity).toBeLessThan(1);
  });
});

describe('masked line reveal (A4)', () => {
  it('the mask box of each line contains the real ink of "ễ" and "Hương"', () => {
    for (const text of ['Nguyễn', 'Hương', 'Nguyễn Thị Hương', 'Ỗ ặ'.normalize('NFD')]) {
      const W = 900;
      const H = 300;
      const document = validate({
        version: 1,
        stage: {
          children: [
            {
              kind: 'scene',
              name: 'S',
              width: W,
              height: H,
              fill: '#000000',
              active: true,
              children: [{ kind: 'text', x: 40, y: 80, text, color: '#FFFFFF', fontSize: 96, fontWeight: 700 }],
            },
          ],
        },
      });
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d');
      createRenderer(document, NO_MEDIA).render(ctx as never, 0);
      const data = ctx.getImageData(0, 0, W, H).data;
      let top = H;
      let bottom = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4]! > 16) (top = Math.min(top, y)), (bottom = Math.max(bottom, y));

      const root = buildTree(document.stage.children[0] as never, NO_MEDIA);
      evaluate(root, 0, [1, 0, 0, 1, 0, 0], ctx as never);
      const node = root.children[0]!;
      const masks = [...lineMasks(ctx as never, node.layout!.words, 'top').values()];
      expect(masks).toHaveLength(1);
      const [, maskTop, , maskHeight] = masks[0]!;
      // Node space → scene space: the node sits at y = 80.
      expect(80 + maskTop, `${text} top`).toBeLessThanOrEqual(top);
      expect(80 + maskTop + maskHeight, `${text} bottom`).toBeGreaterThanOrEqual(bottom + 1);
    }
  });

  it('a masked slide never draws outside its line box, mid reveal', () => {
    const W = 900;
    const H = 400;
    const text = 'Nguyễn Thị Hương';
    const nodes = (animations: unknown[]) =>
      validate({
        version: 1,
        stage: {
          children: [
            {
              kind: 'scene',
              name: 'S',
              width: W,
              height: H,
              fill: '#000000',
              active: true,
              children: [{ kind: 'text', id: 'm', x: 40, y: 120, end: 4, text, color: '#FFFFFF', fontSize: 80, fontWeight: 700, animations }],
            },
          ],
        },
      });
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    createRenderer(nodes([{ type: 'slideUp', unit: 'word', mask: true, duration: 1 }]), NO_MEDIA).render(ctx as never, 8);
    const data = ctx.getImageData(0, 0, W, H).data;
    const root = buildTree(nodes([]).stage.children[0] as never, NO_MEDIA);
    evaluate(root, 0, [1, 0, 0, 1, 0, 0], ctx as never);
    const [[, maskTop, , maskHeight]] = [...lineMasks(ctx as never, root.children[0]!.layout!.words, 'top').values()] as [number, number, number, number][];
    let ink = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4]! <= 16) continue;
        ink++;
        expect(y).toBeGreaterThanOrEqual(Math.floor(120 + maskTop!));
        expect(y).toBeLessThanOrEqual(Math.ceil(120 + maskTop! + maskHeight!));
      }
    }
    // Mid reveal: some text is drawn, not all of it.
    expect(ink).toBeGreaterThan(100);
  });
});
