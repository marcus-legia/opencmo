import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AnimationSchema, documentHash, DocumentInvalidError, migrate, parseTime, timingIssues, validate, type ClipDocument } from './index.ts';

const SAMPLES = join(import.meta.dirname, '../../editor-parity/samples');
const manifest = JSON.parse(readFileSync(join(SAMPLES, 'manifest.json'), 'utf8')) as { samples: { id: string }[] };
const sample = (id: string): unknown => JSON.parse(readFileSync(join(SAMPLES, `${id}.json`), 'utf8'));

// Mẫu là document JSON đã chốt cùng ảnh vàng DS (R7 gỡ đường TSX → document).
describe('kho mẫu', () => {
  it.each(manifest.samples.map((item) => item.id))('%s qua validate, không đổi gì', (id) => {
    const document = sample(id);
    expect(validate(document)).toEqual(document);
  });

  it('covers all 71 samples (67 from DS + 4 from OpenCMO)', () => {
    expect(manifest.samples.length).toBe(71);
  });
});

describe('parseTime: thời gian quy về giây', () => {
  it('bốn dạng của DS', () => {
    expect(parseTime(2.5)).toBe(2.5);
    expect(parseTime('15f')).toBe(0.5);
    expect(parseTime('-30f')).toBe(-1);
    expect(parseTime('02:30')).toBe(150);
    expect(parseTime('01:02:30')).toBe(3750);
    expect(parseTime('-00:30')).toBe(-30);
    expect(() => parseTime('soon')).toThrow(/unrecognized time/);
  });
});

describe('migrate', () => {
  it('version 1 đi thẳng qua validate', () => {
    const document = validate({
      version: 1,
      stage: { children: [{ kind: 'scene', name: 'S', width: 1080, height: 1920, active: true, children: [{ kind: 'rect', fill: '#fff' }] }] },
    });
    expect(migrate(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('version lạ, thiếu, mới hơn editor', () => {
    expect(() => migrate({ stage: { children: [] } })).toThrow(/no valid version/);
    expect(() => migrate({ version: 99, stage: { children: [] } })).toThrow(/newer than this editor/);
    expect(() => migrate([])).toThrow(/must be an object/);
  });
});

describe('validate + documentHash', () => {
  const base = (): ClipDocument =>
    validate({
      version: 1,
      stage: {
        children: [
          {
            kind: 'scene',
            id: 's',
            width: 1080,
            height: 1920,
            children: [
              { kind: 'rect', id: 'a', width: 10, height: 10 },
              { kind: 'rect', id: 'b', width: 10, height: 10 },
            ],
          },
        ],
      },
    });

  it('từ chối id trùng, kể cả ở tầng khác nhau', () => {
    const document = base();
    (document.stage.children[0] as { children: { id?: string }[] }).children[1]!.id = 'a';
    expect(() => validate(document)).toThrow(DocumentInvalidError);
    expect(() => validate(document)).toThrow(/two elements with id "a"/);
  });

  it('từ chối document quá cỡ và document sai schema', () => {
    const document = base();
    (document.stage.children[0] as { name?: string }).name = 'x'.repeat(300_000);
    expect(() => validate(document)).toThrow(/too large/);
    expect(() => validate({ version: 1, stage: { kind: 'rect' } })).toThrow(/not valid/);
  });

  it('hash không phụ thuộc thứ tự khoá', async () => {
    const document = base();
    const shuffled = { stage: document.stage, version: document.version } as ClipDocument;
    expect(await documentHash(shuffled)).toBe(await documentHash(document));
    expect(await documentHash(document)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Fork đặt `muted` bằng nút của hàng timeline trên MỌI lớp, không riêng video/âm
// thanh. Thiếu khoá này thì lượt lưu đó bị server trả 422 (B1 soi ra ở B3).
it('muted trên group, sequence và lớp không có tiếng', () => {
  const doc = validate({
    version: 1,
    stage: {
      children: [
        {
          kind: 'scene',
          width: 100,
          height: 100,
          children: [
            { kind: 'sequence', muted: true, children: [{ kind: 'rect', muted: true }] },
            { kind: 'group', muted: true, children: [{ kind: 'text', muted: true, text: 'a' }] },
          ],
        },
      ],
    },
  });
  expect(JSON.stringify(doc).match(/"muted":true/g)).toHaveLength(4);
});

// Soundboard của fork đặt `volume` lên lớp trên cùng có tiếng — một sequence
// (video đã cắt), group, hay hình chữ nhật mang paint video (cách fork chèn
// B-roll). Thiếu khoá thì lượt lưu đó bị 422 (B5).
it('volume trên group, sequence và hình chứa paint video', () => {
  const doc = validate({
    version: 1,
    stage: {
      children: [
        {
          kind: 'scene',
          width: 100,
          height: 100,
          children: [
            { kind: 'sequence', volume: -6, children: [{ kind: 'rect' }] },
            { kind: 'group', volume: 3, children: [{ kind: 'rect', volume: -12 }] },
          ],
        },
      ],
    },
  });
  expect(JSON.stringify(doc)).toContain('"volume":-6');
});

describe('schema của marks (R5)', () => {
  /** Document một scene; `marks` đặt lên scene hoặc lên một node con có `kind` cho trước. */
  const withMarks = (marks: unknown, kind: 'scene' | 'audio' | 'sequence' | 'group' = 'scene') => {
    const child =
      kind === 'audio'
        ? { kind: 'audio', src: 'a.mp3', marks }
        : kind === 'sequence'
          ? { kind: 'sequence', marks, children: [] }
          : kind === 'group'
            ? { kind: 'group', marks, children: [] }
            : null;
    return {
      version: 1,
      stage: {
        children: [{ kind: 'scene', width: 1080, height: 1920, ...(child ? { children: [child] } : { marks }) }],
      },
    };
  };
  const ok = (marks: unknown, kind?: Parameters<typeof withMarks>[1]) => expect(() => validate(withMarks(marks, kind))).not.toThrow();
  const bad = (marks: unknown, pattern: RegExp, kind?: Parameters<typeof withMarks>[1]) =>
    expect(() => validate(withMarks(marks, kind))).toThrow(pattern);

  const kit = {
    version: 1,
    colors: { primary: '#38BDF8', secondary: '#F472B6', accent: '#FACC15', text: '#FFFFFF', background: '#0F172A' },
    fonts: { heading: 'Montserrat', body: 'Inter' },
    captions: { preset: 'spotlight' },
    layout: { aspect: '9:16', fit: 'fill' },
    logo: null,
  };

  it('nhận đúng hình dạng mà writer ghi ra', () => {
    ok({ reframe: { focus: 0.5, track: [[2, 0.3], [14, 0.75]], mode: 'fill' } });
    // Document cũ thiếu `mode`: reader coi là fill.
    ok({ reframe: { focus: 0.5, track: [] } });
    ok({ layout: { ranges: [{ start: 0, end: 3, mode: 'pip', ratio: 0.36, anchor: 'bottom-right' }] } });
    ok({ layout: { ranges: [{ start: 1, end: 4, mode: 'cell', ratio: 1, rect: [0, 0, 0.5, 1], focus: [0.5, 0.4], fit: 'fit' }] } });
    ok({ layout: 'speaker' }, 'group');
    ok({ 'text-cut': { transcript: 'assets/transcript.json', window: { start: 2, end: 32 }, removed: [{ start: 5, end: 6 }], roll: { '8': 0.5 } } }, 'sequence');
    ok({ 'cut-audio': true }, 'audio');
    ok({ voiceover: { key: 'v1', mode: 'overlay', duck: -18, synced: true } }, 'audio');
    ok({ voiceover: { key: 'v1' } }, 'group');
    ok({ 'voiceover-replaced': { videos: [{ muted: false }], captions: [{ hidden: true }] } });
    ok({ 'voiceover-duck': { keyframes: [{ time: 1, value: -18, easing: 'linear' }] } });
    ok({ brand: kit });
    ok({ 'brand-logo': true }, 'group');
    ok({ markers: [{ id: 'm1', name: 'Fix this', time: 3, duration: 0, color: 'red', status: 'open' }] });
    ok({ visual: { op: 'add_chart', input: { anything: [1, 2] } } }, 'group');
    ok({ studio3d: { quote: 'revenue doubled' } }, 'group');
  });

  it('từ chối mark sai thay vì để reader bỏ qua im lặng', () => {
    bad({ reframe: { focus: '0.5', track: [] } }, /reframe/);
    bad({ reframe: { focus: 0.5, track: [[2]] } }, /reframe/);
    bad({ layout: { ranges: [{ start: 0, end: 3, mode: 'full', ratio: 1 }] } }, /layout/);
    bad({ layout: { ranges: [{ start: 0, end: 3, mode: 'cell', ratio: 1, rect: [0, 0, 2, 1] }] } }, /layout/);
    bad({ layout: 'sidebar' }, /layout/, 'group');
    // Transcript là tham chiếu `src`, không bao giờ là nguyên transcript.
    bad({ 'text-cut': { transcript: [{ words: [] }], window: { start: 0, end: 1 }, removed: [] } }, /text-cut/, 'sequence');
    bad({ 'cut-audio': 'yes' }, /cut-audio/, 'audio');
    bad({ voiceover: { key: 'v1', mode: 'dub', duck: 0 } }, /voiceover/, 'audio');
    bad({ brand: { ...kit, colors: { ...kit.colors, accent: 'yellow' } } }, /brand/);
    bad({ markers: [{ id: 'm1', name: 'x', time: -1, duration: 0, color: 'red', status: 'open' }] }, /markers/);
    bad({ visual: { input: {} } }, /visual/, 'group');
  });

  it('khoá lạ là lỗi: thêm mark mới thì thêm schema', () => {
    bad({ wobble: 1 }, /wobble/);
  });
});

describe('storedBytes', () => {
  it('measures the document the way the database does (jsonb text: a space after every : and ,)', async () => {
    const { storedBytes } = await import('./validate.ts');
    const document = {
      version: 1,
      stage: {
        children: [
          {
            kind: 'scene',
            name: 'Đoạn 1',
            width: 1080,
            height: 1920,
            children: [
              { kind: 'text', text: 'Hi, "there": a,b', x: 1.5, tracks: [{ property: 'x', keyframes: [{ time: 0, value: 1 }, { time: 2, value: -3.25 }] }] },
              { kind: 'rect', paints: [] },
            ],
          },
        ],
      },
    };
    // Python json.dumps(separators=(', ', ': '), ensure_ascii=False) prints like Postgres jsonb::text.
    expect(storedBytes(document)).toBe(314);
    expect(storedBytes(document)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(document)).length);
  });
});

describe('timingIssues', () => {
  const doc = (node: Record<string, unknown>) => ({ version: 1, stage: { children: [{ kind: 'scene', id: 's', children: [node] }] } });
  const kinds = (node: Record<string, unknown>) => timingIssues(doc(node)).map((issue) => issue.kind);

  it('sample documents have none', () => {
    for (const item of manifest.samples) expect(timingIssues(sample(item.id)), item.id).toEqual([]);
  });
  it('start must be before end', () => {
    expect(kinds({ kind: 'video', id: 'v', start: 2, end: 1 })).toEqual(['start-after-end']);
    expect(kinds({ kind: 'video', id: 'v', start: 2, end: 2 })).toEqual(['start-after-end']);
    expect(kinds({ kind: 'video', id: 'v', start: 1, end: 2 })).toEqual([]);
  });
  it('sourceIn must be before sourceOut', () => {
    expect(kinds({ kind: 'video', id: 'v', sourceIn: 5, sourceOut: 4 })).toEqual(['source-in-after-out']);
  });
  it('times cannot be negative', () => {
    expect(kinds({ kind: 'video', id: 'v', start: -1 })).toEqual(['negative-time']);
    expect(kinds({ kind: 'video', id: 'v', sourceIn: -0.5, sourceOut: 3 })).toEqual(['negative-time']);
  });
  it('playbackRate must be positive', () => {
    expect(kinds({ kind: 'video', id: 'v', playbackRate: 0 })).toEqual(['bad-playback-rate']);
    expect(kinds({ kind: 'video', id: 'v', playbackRate: 1.5 })).toEqual([]);
  });
  it('finds nested nodes and names them in the message', () => {
    const issues = timingIssues(doc({ kind: 'group', id: 'g', children: [{ kind: 'text', name: 'Title', start: 3, end: 1 }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.key).toBe('text@3,1,,,');
    expect(issues[0]!.message).toBe('Text "Title": start (3s) must be before end (1s).');
  });
});

describe('unit animations (unit / order / step / mask)', () => {
  const ok = (animation: unknown) => AnimationSchema.safeParse(animation).success;
  const messages = (animation: unknown) => AnimationSchema.safeParse(animation).error?.issues.map((issue) => issue.message) ?? [];

  it('accepts valid combinations', () => {
    expect(ok({ type: 'fade', unit: 'char' })).toBe(true);
    expect(ok({ type: 'slideUp', unit: 'word', order: 'center', step: 0.05, mask: true })).toBe(true);
    expect(ok({ type: 'slideDown', unit: 'line', mask: false })).toBe(true);
    expect(ok({ type: 'pop', unit: 'char', order: 'random', phase: 'out' })).toBe(true);
    expect(ok({ type: 'blur', unit: 'word', order: 'last' })).toBe(true);
    expect(ok({ type: 'spin' })).toBe(true);
  });

  it('rejects unit on animations that cannot run per unit', () => {
    expect(messages({ type: 'spin', unit: 'word' })).toEqual([
      'unit works with fade, slideUp, slideDown, slideLeft, slideRight, pop, blur, grow; not with spin.',
    ]);
    expect(ok({ type: 'typewriter', unit: 'char' })).toBe(false);
  });

  it('rejects order, step and mask without unit', () => {
    expect(messages({ type: 'fade', order: 'last' })).toEqual(['order needs unit (char, word or line).']);
    expect(messages({ type: 'slideUp', step: 0.05 })).toEqual(['step needs unit (char, word or line).']);
    expect(ok({ type: 'slideUp', mask: true })).toBe(false);
  });

  it('rejects mask on anything but slideUp/slideDown', () => {
    expect(messages({ type: 'fade', unit: 'line', mask: true })).toEqual(['mask works with slideUp and slideDown; not with fade.']);
  });

  it('keeps step inside 0.02–0.5 s', () => {
    expect(ok({ type: 'fade', unit: 'char', step: 0.01 })).toBe(false);
    expect(ok({ type: 'fade', unit: 'char', step: 0.6 })).toBe(false);
  });

  it('validates inside a document', () => {
    const doc = {
      version: 1,
      stage: {
        children: [
          {
            kind: 'scene',
            name: 'S',
            width: 100,
            height: 100,
            children: [{ kind: 'text', text: 'Hi', animations: [{ type: 'twist', unit: 'char' }] }],
          },
        ],
      },
    };
    expect(() => validate(doc)).toThrow(DocumentInvalidError);
  });
});
