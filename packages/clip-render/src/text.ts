/**
 * Chữ: dàn dòng rồi vẽ, theo đúng cách người dùng đang thấy trong fork.
 *
 * ## Dàn dòng
 *
 * - Chữ chia thành ĐOẠN tại mọi mép của `<textRange>`. Mỗi đoạn lấy kiểu của
 *   `<text>`, và range nào phủ đoạn đó thì ghi đè lên, range viết sau thắng.
 * - Mỗi đoạn tách thành TỪ, dấu cách dính vào cuối từ đứng trước. Đo từng từ
 *   bằng chính canvas. Từ nào tràn `width` đã viết thì xuống dòng, trừ từ đầu
 *   dòng. `\n` luôn xuống dòng.
 * - Cao một dòng = cao hộp font (ascent + descent của font, không phải của
 *   glyph) lớn nhất trong dòng. Các dòng cách nhau `cao · leading`, riêng dòng
 *   cuối không nhân.
 * - **Chỉ khi có CẢ `width` lẫn `height` thì hộp mới cố định.** Thiếu một trong
 *   hai là hộp co theo chữ, nên `textAlign`/`textBaseline` không còn gì để căn
 *   (checklist §4).
 * - Toạ độ vẽ mỗi từ bị CẮT về số nguyên.
 *
 * ## Vẽ
 *
 * Ba lượt trên toàn bộ từ: bóng, rồi viền, rồi màu. Bóng của chữ có viền lấy
 * hình của viền dày nhất. Paint ảnh/video trên chữ không vẽ ảnh mà tô đen —
 * fork làm vậy, và ảnh vàng `text-paint` giữ đúng điều đó.
 */

import type { Paint, Shadow, Stroke, TextNode, TextRange } from '@opencmo/clip-doc';

import { hex, parseColor } from './color.ts';
import { FONTS } from './fonts.ts';
import { curve } from './easing.ts';
import { FPS, type RNode, type UnitFx } from './tree.ts';
import type { Ctx2D } from './types.ts';
import { graphemes, unitProgress, unitRanks } from './units.ts';

/** Những gì dàn dòng cần từ canvas: đặt font và đo. */
export type Measurer = Pick<Ctx2D, 'save' | 'restore'> & {
  font: string;
  textBaseline: string;
  letterSpacing: string;
  measureText(text: string): TextMetricsLike;
};

export type TextMetricsLike = {
  width: number;
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
  /** Real glyph bounds (marks above "ễ" reach past the font box); both canvases provide them. */
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
};

type Style = {
  size: number;
  family: string;
  weight: string;
  style: string;
  spacing: number;
  textCase: string;
  /** Range phủ đoạn này, theo thứ tự viết — để tìm màu/paint/viền/bóng ghi đè. */
  ranges: TextRange[];
};

export type Word = {
  chars: string;
  style: Style;
  width: number;
  height: number;
  ascent: number;
  /** Chỉ ở Node: dời thêm khi vẽ theo baseline chữ (0 trong trình duyệt). */
  drop: number;
  x: number;
  y: number;
};

/** `bounds`: hộp chữ THẬT trong khung của node `[x, y, w, h]` — chữ có thể tràn hộp cố định (phụ đề). */
export type TextLayout = { words: Word[]; width: number; height: number; bounds: [number, number, number, number] };

const WEIGHTS: Record<string, string> = { normal: '400', bold: '700' };

function styleFor(node: TextNode, ranges: TextRange[]): Style {
  let size = node.fontSize ?? 16;
  let family = node.fontFamily || 'Inter';
  let weight = node.fontWeight ?? '400';
  let style = node.fontStyle ?? 'normal';
  let spacing = node.letterSpacing ?? 0;
  let textCase = node.textCase ?? 'original';
  for (const range of ranges) {
    size = range.fontSize ?? size;
    family = range.fontFamily ?? family;
    weight = range.fontWeight ?? weight;
    style = range.fontStyle ?? style;
    spacing = range.letterSpacing ?? spacing;
    textCase = range.textCase ?? textCase;
  }
  return { size, family, weight: WEIGHTS[String(weight)] ?? String(weight), style, spacing, textCase, ranges };
}

/**
 * Đặt font lên context. Chromium tự chọn trục `wght`/`opsz` của font variable
 * theo độ đậm và cỡ chữ (optical sizing: opsz = cỡ px). Skia của Node thì
 * không, nên nơi nào có `fontVariationSettings` thì đặt tay cho giống.
 */
/**
 * Families tried after the brand font, for scripts it does not cover (translated captions, emoji).
 * The browser falls back on its own; Skia in the export does not, and draws boxes. The exporter
 * sets them from what is really installed (`clip-export` `registerFonts`), with a Latin font
 * first: when the brand font is missing, Skia takes the first family it has, and an emoji font
 * there draws no Latin text at all.
 */
let fallbackFamilies = '';

export function setFallbackFamilies(families: string[]): void {
  fallbackFamilies = families.map((family) => `, "${family}"`).join('');
}

export function applyFont(ctx: Measurer, style: Style, baseline: string): void {
  ctx.font = `${style.style} ${style.weight} ${style.size}px ${style.family}${fallbackFamilies}`;
  ctx.letterSpacing = `${style.spacing}px`;
  if (isChromium(ctx)) {
    ctx.textBaseline = baseline;
  } else {
    // Skia của Node: đặt trục font variable bằng tay, và vẽ theo baseline chữ
    // (xem `drop`), vì `top/middle/bottom` của nó không trùng Chromium.
    ctx.textBaseline = 'alphabetic';
    const opsz = Math.min(32, Math.max(14, style.size));
    (ctx as unknown as { fontVariationSettings: string }).fontVariationSettings = `"wght" ${style.weight}, "opsz" ${opsz}`;
  }
}

/** Canvas của trình duyệt không có `fontVariationSettings`; của `@napi-rs/canvas` thì có. */
const isChromium = (ctx: object) => !('fontVariationSettings' in ctx);

/**
 * Khoảng từ điểm neo theo `baseline` xuống baseline chữ, như Chromium tính:
 * hộp em cao đúng một cỡ chữ, đỉnh của nó ở `emTop · cỡ` trên baseline chữ.
 */
function drop(style: Style, baseline: string, metrics: TextMetricsLike): number {
  if (baseline === 'alphabetic') return 0;
  const known = (FONTS as Record<string, { emTop: number }>)[style.family]?.emTop;
  const emTop = known ?? metrics.fontBoundingBoxAscent / (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
  const offset = baseline === 'middle' ? emTop - 0.5 : baseline === 'bottom' ? emTop - 1 : emTop;
  return offset * style.size;
}

/**
 * Số đo một từ theo nghĩa của Chromium. Ở Node: đo theo baseline chữ, rồi làm
 * tròn ascent/descent riêng từng cái như Chromium làm khi báo hộp font.
 */
function measure(ctx: Measurer, text: string, style: Style, baseline: string) {
  const metrics = ctx.measureText(text);
  if (isChromium(ctx)) {
    return {
      width: metrics.width,
      height: metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
      ascent: metrics.fontBoundingBoxAscent,
      drop: 0,
    };
  }
  const ascent = Math.round(metrics.fontBoundingBoxAscent);
  // Ascent của font × cỡ rơi đúng nửa pixel (Inter 48/80/112 px…): hai bên làm tròn
  // mặt nạ glyph về hai phía, chữ của Node thấp hơn 1 px. Đo trên 10 font × 60 cỡ,
  // luật này đúng 600/600.
  const tie = Math.abs((metrics.fontBoundingBoxAscent % 1) - 0.5) < 1e-6 ? -1 : 0;
  return {
    width: metrics.width,
    height: ascent + Math.round(metrics.fontBoundingBoxDescent),
    ascent,
    drop: drop(style, baseline, metrics) + tie,
  };
}

const casing = (text: string, textCase: string) =>
  textCase === 'upper' ? text.toUpperCase() : textCase === 'lower' ? text.toLocaleLowerCase() : text;

/** Tách giữ dấu cách ở cuối mỗi từ: "a b c" → ["a ", "b ", "c"]. */
function splitWords(text: string): string[] {
  if (!text.includes(' ')) return [text];
  const out: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ' ') {
      out.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** Đoạn chữ theo mép của các range, mỗi đoạn kèm range đang phủ nó. */
function segments(text: string, ranges: TextRange[]): { text: string; ranges: TextRange[] }[] {
  if (!ranges.length) return [{ text, ranges: [] }];
  if (!text.length) return [];
  const clampIndex = (value: number) => Math.min(text.length, Math.max(0, value));
  const span = (range: TextRange) => [clampIndex(range.start), clampIndex(range.end ?? text.length)] as const;
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((range) => span(range))])].sort((a, b) => a - b);
  const out: { text: string; ranges: TextRange[] }[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const from = cuts[index]!;
    const to = cuts[index + 1]!;
    if (from >= to) continue;
    const covering = ranges.filter((range) => {
      const [start, end] = span(range);
      return start <= from && end > from;
    });
    out.push({ text: text.slice(from, to), ranges: covering });
  }
  return out;
}

/**
 * Dàn dòng. `values.width/height` của node được thay bằng hộp chữ khi node
 * không có đủ cả hai.
 */
export function layoutText(measurer: Measurer, r: RNode, chars: string, node: TextNode): TextLayout {
  const baseline = node.textBaseline ?? 'top';
  const maxWidth = typeof node.width === 'number' ? node.width : Infinity;
  const lines: Word[][] = [[]];
  let offset = 0;
  measurer.save();
  for (const segment of segments(chars, node.ranges ?? [])) {
    const style = styleFor(node, segment.ranges);
    applyFont(measurer, style, baseline);
    for (const word of splitWords(segment.text)) {
      const parts = word.split('\n');
      parts.forEach((part, index) => {
        const text = casing(part, style.textCase);
        const metrics = measure(measurer, text, style, baseline);
        if (offset + metrics.width > maxWidth && offset > 0) {
          lines.push([]);
          offset = 0;
        }
        lines[lines.length - 1]!.push({ chars: text, style, ...metrics, x: offset, y: 0 });
        offset += metrics.width;
        if (index < parts.length - 1) {
          lines.push([]);
          offset = 0;
        }
      });
    }
  }
  measurer.restore();

  const leading = node.leading ?? 1;
  const widths = lines.map((line) => line.reduce((sum, word) => sum + word.width, 0));
  const heights = lines.map((line) => Math.max(...line.map((word) => word.height)));
  const total = heights.reduce((sum, height, index) => sum + height * (index < heights.length - 1 ? leading : 1), 0);
  const v = r.values;
  if (!v.width || !v.height) {
    v.width = Math.ceil(Math.max(...widths));
    v.height = Math.ceil(total);
  }
  const align = node.textAlign ?? 'left';
  let top = baseline === 'middle' ? (v.height - total) / 2 : baseline === 'bottom' ? v.height - total : 0;
  const lefts = widths.map((width) => (align === 'center' ? (v.width - width) / 2 : align === 'right' ? v.width - width : 0));
  const minX = Math.min(...lefts);
  const bounds: [number, number, number, number] = [minX, top, Math.max(...lefts.map((left, index) => left + widths[index]!)) - minX, total];
  lines.forEach((line, index) => {
    const height = heights[index]!;
    const left = lefts[index]!;
    const drop =
      baseline === 'middle' ? height / 2
      : baseline === 'bottom' ? height
      : baseline === 'alphabetic' ? Math.max(...line.map((word) => word.ascent)) || height * 0.75
      : 0;
    for (const word of line) {
      word.x = (word.x + left) | 0;
      word.y = (top + drop) | 0;
    }
    top += height * leading;
  });
  return { words: lines.flat(), width: v.width, height: v.height, bounds };
}

// ------------------------------------------------------------------ vẽ

type Lookup = (holder: object, key: string, fallback: number) => number;

/** Thứ range ghi đè lên chữ: range cuối có danh sách không rỗng thắng. */
function override<T>(node: TextNode, ranges: TextRange[], key: 'paints' | 'strokes' | 'shadows'): T[] {
  let list = ((node as Record<string, unknown>)[key] as T[] | undefined) ?? [];
  for (const range of ranges) {
    const own = (range as Record<string, unknown>)[key] as T[] | undefined;
    if (own?.length) list = own;
  }
  return list;
}

/** Giá trị đã viết của thành phần phụ — fork đọc bóng/viền/paint của chữ từ đây, không theo keyframe. */
const own = (holder: object, key: string, fallback: number): number => {
  const value = (holder as Record<string, unknown>)[key];
  if (key === 'color' && typeof value === 'string') return parseColor(value);
  return typeof value === 'number' ? value : fallback;
};

export function drawText(
  ctx: Ctx2D & Measurer & { fillText(t: string, x: number, y: number): void; strokeText(t: string, x: number, y: number): void },
  r: RNode,
  layout: TextLayout,
  node: TextNode,
  live: Lookup,
  gradient: (paint: Extract<Paint, { stops: unknown }>) => unknown,
  shadowScale: number,
): void {
  const baseline = node.textBaseline ?? 'top';
  const saved = ctx.globalAlpha;

  // Dòng thật của chữ (bỏ từ toàn khoảng trắng): dùng cho hộp nền và gạch dưới/trên/ngang.
  const lineBoxes = new Map<number, { x0: number; x1: number; top: number; height: number; ascent: number; size: number }>();
  for (const word of layout.words) {
    if (!word.chars.trim()) continue;
    const top = word.y - (baseline === 'middle' ? word.height / 2 : baseline === 'bottom' ? word.height : baseline === 'alphabetic' ? word.ascent : 0);
    const line = lineBoxes.get(word.y);
    if (line) (line.x0 = Math.min(line.x0, word.x)), (line.x1 = Math.max(line.x1, word.x + word.width));
    else lineBoxes.set(word.y, { x0: word.x, x1: word.x + word.width, top, height: word.height, ascent: word.ascent, size: word.style.size });
  }

  // Lượt 0a: hộp nền (E4, học Palmier TextStyle.Background) — cả khối hoặc từng dòng.
  const background = (node as { background?: { color: string; paddingX?: number; paddingY?: number; radius?: number; outlineColor?: string; outlineWidth?: number; perLine?: boolean } }).background;
  if (background && lineBoxes.size) {
    const lines = [...lineBoxes.values()];
    const boxes = background.perLine
      ? lines
      : [{ x0: Math.min(...lines.map((l) => l.x0)), x1: Math.max(...lines.map((l) => l.x1)), top: Math.min(...lines.map((l) => l.top)), height: Math.max(...lines.map((l) => l.top + l.height)) - Math.min(...lines.map((l) => l.top)) }];
    const padX = background.paddingX ?? lines[0]!.height * 0.3;
    const padY = background.paddingY ?? lines[0]!.height * 0.12;
    ctx.save();
    for (const box of boxes) {
      ctx.beginPath();
      ctx.roundRect(box.x0 - padX, box.top - padY, box.x1 - box.x0 + padX * 2, box.height + padY * 2, background.radius ?? 0);
      ctx.fillStyle = background.color;
      ctx.fill();
      if (background.outlineWidth && background.outlineColor) {
        ctx.lineWidth = background.outlineWidth;
        ctx.strokeStyle = background.outlineColor;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Lượt 0: hộp nhấn sau từ đang nói (phụ đề `highlight: 'block'`), mỗi dòng một hộp.
  const block = r.caption?.block;
  if (block) {
    const lines = new Map<number, { x0: number; x1: number; top: number; height: number }>();
    for (const word of layout.words) {
      if (!word.style.ranges.includes(block.range) || !word.chars.trim()) continue;
      // `y` là điểm neo theo baseline của dòng (cùng luật dàn dòng ở trên) — lùi về đỉnh dòng.
      const top =
        word.y - (baseline === 'middle' ? word.height / 2 : baseline === 'bottom' ? word.height : baseline === 'alphabetic' ? word.ascent : 0);
      const line = lines.get(word.y);
      if (line) (line.x0 = Math.min(line.x0, word.x)), (line.x1 = Math.max(line.x1, word.x + word.width));
      else lines.set(word.y, { x0: word.x, x1: word.x + word.width, top, height: word.height });
    }
    ctx.save();
    ctx.fillStyle = block.color;
    for (const line of lines.values()) {
      const pad = line.height * 0.12;
      ctx.beginPath();
      ctx.roundRect(line.x0 - pad * 1.4, line.top - pad * 0.4, line.x1 - line.x0 + pad * 2.8, line.height + pad * 0.8, line.height * 0.22);
      ctx.fill();
    }
    ctx.restore();
  }

  // Per-word / per-unit animation: each word (or letter) can move, scale around a centre, fade,
  // blur, change color or be clipped to its line — applied in every pass below.
  const fx = r.unitFx;
  const words = fx?.unit === 'char' ? letters(ctx, layout.words, baseline) : layout.words;
  const tweakOf = fx ? unitTweaks(ctx, fx, words, layout.words, baseline) : wordTweaks(r, layout);
  const enter = (word: Word): { alpha: number; color?: string } | null => {
    const tweak = tweakOf(word);
    if (!tweak) return null;
    const top = word.y - (baseline === 'middle' ? word.height / 2 : baseline === 'bottom' ? word.height : baseline === 'alphabetic' ? word.ascent : 0);
    const cx = tweak.cx ?? word.x + word.width / 2;
    const cy = tweak.cy ?? top + word.height / 2;
    ctx.save();
    if (tweak.clip) {
      ctx.beginPath();
      ctx.rect(...tweak.clip);
      ctx.clip();
    }
    if (tweak.blur) ctx.filter = `${ctx.filter && ctx.filter !== 'none' ? `${ctx.filter} ` : ''}blur(${tweak.blur}px)`;
    ctx.translate(cx + tweak.dx, cy + tweak.dy);
    ctx.scale(tweak.scale, tweak.scale);
    ctx.translate(-cx, -cy);
    return tweak;
  };

  // Lượt 1: bóng.
  ctx.save();
  for (const word of words) {
    const tweak = enter(word);
    const fade = tweak?.alpha ?? 1;
    if (fade <= 0) {
      if (tweak) ctx.restore();
      continue;
    }
    applyFont(ctx, word.style, baseline);
    const shadows = override<Shadow>(node, word.style.ranges, 'shadows');
    const strokes = override<Stroke>(node, word.style.ranges, 'strokes').filter((stroke) => !stroke.hidden);
    const widest = strokes.reduce<Stroke | null>(
      (best, stroke) => (best === null || live(stroke, 'width', 1) > live(best, 'width', 1) ? stroke : best),
      null,
    );
    if (widest) strokeStyle(ctx, widest, live);
    for (const shadow of shadows) {
      if (shadow.hidden) continue;
      ctx.shadowOffsetX = own(shadow, 'offsetX', 0) * shadowScale;
      ctx.shadowOffsetY = own(shadow, 'offsetY', 0) * shadowScale;
      ctx.shadowBlur = own(shadow, 'blur', 0) * shadowScale;
      const color = hex(own(shadow, 'color', 0));
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = saved * fade * own(shadow, 'opacity', 1);
      if (widest) ctx.strokeText(word.chars, word.x, Math.round(word.y + word.drop));
      else ctx.fillText(word.chars, word.x, Math.round(word.y + word.drop));
    }
    if (shadows.length) {
      ctx.globalAlpha = saved;
      ctx.shadowColor = 'transparent';
    }
    if (tweak) ctx.restore();
  }
  ctx.restore();

  // Lượt 2: viền.
  ctx.save();
  for (const word of words) {
    const strokes = override<Stroke>(node, word.style.ranges, 'strokes');
    if (!strokes.length) continue;
    const tweak = enter(word);
    const fade = tweak?.alpha ?? 1;
    applyFont(ctx, word.style, baseline);
    for (const stroke of strokes) {
      if (stroke.hidden || fade <= 0) continue;
      const composite = ctx.globalCompositeOperation;
      if (stroke.blendMode && stroke.blendMode !== 'sourceOver') ctx.globalCompositeOperation = dash(stroke.blendMode);
      ctx.globalAlpha = saved * fade * own(stroke, 'opacity', 1);
      strokeStyle(ctx, stroke, live);
      ctx.strokeStyle = hex(own(stroke, 'color', 0));
      ctx.strokeText(word.chars, word.x, Math.round(word.y + word.drop));
      ctx.globalCompositeOperation = composite;
    }
    if (tweak) ctx.restore();
  }
  ctx.restore();

  // Lượt 3: màu chữ, rồi paint.
  ctx.save();
  for (const word of words) {
    let color: number | null = r.values.color;
    for (const range of word.style.ranges) {
      if (typeof range.color === 'string') color = live(range, 'color', parseColor(range.color));
    }
    let paints = override<Paint>(node, word.style.ranges, 'paints');
    const tweak = enter(word);
    const fade = tweak?.alpha ?? 1;
    // highlightPop: từ đang tới đổi hẳn sang màu nhấn (paint của node không đè lên).
    if (tweak?.color) {
      color = parseColor(tweak.color);
      paints = [];
    }
    if (fade <= 0 || (!paints.length && color === null)) {
      if (tweak) ctx.restore();
      continue;
    }
    applyFont(ctx, word.style, baseline);
    if (color !== null) {
      ctx.globalAlpha = saved * fade;
      ctx.fillStyle = hex(color);
      ctx.fillText(word.chars, word.x, Math.round(word.y + word.drop));
    }
    for (const paint of paints) {
      if (paint.hidden) continue;
      const composite = ctx.globalCompositeOperation;
      if (paint.blendMode && paint.blendMode !== 'sourceOver') ctx.globalCompositeOperation = dash(paint.blendMode);
      ctx.globalAlpha = saved * fade * own(paint, 'opacity', 1);
      ctx.fillStyle = 'stops' in paint ? gradient(paint) : hex(paint.type === 'solid' ? own(paint, 'color', 0) : 0);
      ctx.fillText(word.chars, word.x, Math.round(word.y + word.drop));
      ctx.globalCompositeOperation = composite;
    }
    if (tweak) ctx.restore();
  }
  ctx.restore();

  // Lượt 4: gạch dưới / trên / ngang theo bề rộng từng dòng, màu chữ.
  const decoration = (node as { decoration?: string[] }).decoration;
  if (decoration?.length && r.values.color !== null) {
    ctx.save();
    ctx.globalAlpha = saved;
    ctx.fillStyle = hex(r.values.color);
    for (const line of lineBoxes.values()) {
      const thickness = Math.max(1, line.size * 0.06);
      for (const kind of decoration) {
        const y = kind === 'underline' ? line.top + line.ascent + thickness * 1.5 : kind === 'overline' ? line.top + thickness * 0.5 : line.top + line.ascent * 0.62;
        ctx.fillRect(line.x0, y - thickness / 2, line.x1 - line.x0, thickness);
      }
    }
    ctx.restore();
  }
}

type Tweak = {
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  color?: string;
  /** Centre to scale around when the unit is wider than the word (a whole line). */
  cx?: number;
  cy?: number;
  /** px of blur on this unit only. */
  blur?: number;
  /** Clip box in the node's space, before the unit moves (masked reveal). */
  clip?: [number, number, number, number];
};

const wordTop = (word: Word, baseline: string) =>
  word.y - (baseline === 'middle' ? word.height / 2 : baseline === 'bottom' ? word.height : baseline === 'alphabetic' ? word.ascent : 0);

/**
 * Prefix widths of each word's graphemes, keyed by font and text: export draws the same title for
 * hundreds of frames, and `measureText` per letter per frame is the cost of `unit: 'char'`.
 */
const PREFIXES = new Map<string, number[]>();

/** Words split into letters (graphemes), each at its kerned x inside the word; whitespace dropped. */
function letters(ctx: Measurer, words: Word[], baseline: string): Word[] {
  const out: Word[] = [];
  ctx.save();
  for (const word of words) {
    if (!word.chars.trim()) continue;
    applyFont(ctx, word.style, baseline);
    const chars = graphemes(word.chars);
    const key = `${ctx.font}|${ctx.letterSpacing}|${word.chars}`;
    let prefix = PREFIXES.get(key);
    if (!prefix) {
      prefix = [0];
      let text = '';
      for (const char of chars) prefix.push(ctx.measureText((text += char)).width);
      if (PREFIXES.size >= 2048) PREFIXES.delete(PREFIXES.keys().next().value!);
      PREFIXES.set(key, prefix);
    }
    chars.forEach((char, index) => {
      if (!char.trim()) return;
      out.push({ ...word, chars: char, x: word.x + prefix[index]!, width: prefix[index + 1]! - prefix[index]! });
    });
  }
  ctx.restore();
  return out;
}

/**
 * Clip box of each line (keyed by `word.y`) for a masked reveal: the font box joined with the real
 * glyph box, so the marks of "ễ" or "Ỗ" that rise above the font's ascent are not cut, plus 0.08 em.
 * Falls back to the font box where the canvas has no `actualBoundingBox*`.
 */
export function lineMasks(ctx: Measurer, words: Word[], baseline: string): Map<number, [number, number, number, number]> {
  const boxes = new Map<number, { x0: number; x1: number; top: number; bottom: number; em: number }>();
  ctx.save();
  for (const word of words) {
    if (!word.chars.trim()) continue;
    applyFont(ctx, word.style, baseline);
    const metrics = ctx.measureText(word.chars);
    const anchor = Math.round(word.y + word.drop);
    const fontTop = wordTop(word, baseline);
    const top = Math.min(fontTop, metrics.actualBoundingBoxAscent === undefined ? fontTop : anchor - metrics.actualBoundingBoxAscent);
    const bottom = Math.max(fontTop + word.height, metrics.actualBoundingBoxDescent === undefined ? -Infinity : anchor + metrics.actualBoundingBoxDescent);
    const box = boxes.get(word.y);
    if (box) {
      box.x0 = Math.min(box.x0, word.x);
      box.x1 = Math.max(box.x1, word.x + word.width);
      box.top = Math.min(box.top, top);
      box.bottom = Math.max(box.bottom, bottom);
      box.em = Math.max(box.em, word.style.size);
    } else boxes.set(word.y, { x0: word.x, x1: word.x + word.width, top, bottom, em: word.style.size });
  }
  ctx.restore();
  const out = new Map<number, [number, number, number, number]>();
  for (const [y, box] of boxes) {
    const pad = box.em * 0.08;
    out.set(y, [box.x0 - pad, box.top - pad, box.x1 - box.x0 + 2 * pad, box.bottom - box.top + 2 * pad]);
  }
  return out;
}

const POP_IN = curve(0.34, 1.56, 0.64, 1);
const POP_OUT = curve(0.36, 0, 0.66, -0.56);
/** Same ease-out as `wordSlide`, so `slideUp` + `unit: 'word'` can replace it frame for frame. */
const easeOut = (p: number) => 1 - (1 - p) ** 3;

/**
 * Per-unit tweaks of a `unitFx` animation. Units are letters, non-blank words, or lines (words
 * sharing a `y`); each starts `rank × step` after the first and runs `total − step × (n − 1)`
 * (at least 0.15 s). Moves are 0.6 × the unit's height, like `wordSlide`; a masked slide travels
 * the whole line box instead and does not fade, so the text rises from behind an edge.
 */
function unitTweaks(ctx: Measurer, fx: UnitFx, words: Word[], all: Word[], baseline: string): (word: Word) => Tweak | null {
  const units: Word[][] = [];
  const unitOf = new Map<Word, number>();
  if (fx.unit === 'line') {
    const rows = new Map<number, number>();
    for (const word of words) {
      if (!word.chars.trim()) continue;
      let index = rows.get(word.y);
      if (index === undefined) rows.set(word.y, (index = units.push([]) - 1));
      units[index]!.push(word);
      unitOf.set(word, index);
    }
  } else {
    for (const word of words) if (word.chars.trim()) unitOf.set(word, units.push([word]) - 1);
  }
  const n = units.length;
  const ranks = unitRanks(n, fx.order, fx.seed);
  const length = Math.max(fx.total - fx.step * (n - 1), 0.15 * FPS);
  const masks = fx.mask ? lineMasks(ctx, all, baseline) : null;
  const centres = units.map((unit) => {
    const x0 = Math.min(...unit.map((word) => word.x));
    const x1 = Math.max(...unit.map((word) => word.x + word.width));
    const top = Math.min(...unit.map((word) => wordTop(word, baseline)));
    const height = Math.max(...unit.map((word) => word.height));
    return { cx: (x0 + x1) / 2, cy: top + height / 2, height };
  });
  return (word) => {
    const index = unitOf.get(word);
    if (index === undefined) return null;
    const p = unitProgress(fx.t, ranks[index]!, fx.step, length);
    const { cx, cy, height } = centres[index]!;
    const base = { dx: 0, dy: 0, scale: 1, alpha: 1, cx, cy };
    // far: 1 = the preset's far state, 0 = the node at rest.
    const e = easeOut(p);
    const far = fx.out ? e : 1 - e;
    switch (fx.type) {
      case 'fade':
        return { ...base, alpha: 1 - far };
      case 'grow':
        return { ...base, scale: 1 - 0.5 * far };
      case 'blur':
        return { ...base, blur: 24 * far };
      case 'pop': {
        const t = fx.out ? 1 - POP_OUT(p) : POP_IN(p);
        return { ...base, scale: 0.6 + 0.4 * t, alpha: Math.min(1, Math.max(0, fx.out ? 1 - p : p * 2)) };
      }
      default: {
        const clip = masks?.get(word.y);
        const travel = clip ? clip[3] : height * 0.6;
        const sign = fx.out ? -1 : 1;
        const shift = sign * travel * far;
        const move =
          fx.type === 'slideUp' ? { dy: shift }
          : fx.type === 'slideDown' ? { dy: -shift }
          : fx.type === 'slideLeft' ? { dx: shift }
          : { dx: -shift };
        return { ...base, ...move, alpha: clip ? 1 : 1 - far, clip };
      }
    }
  };
}

/**
 * Biến đổi của từng từ ở khung này (E4, học Palmier TextAnimation theo từ):
 * - wordSlide: từ thứ i bắt đầu sau i × per khung, trượt lên từ dưới 0.6 chiều cao chữ và hiện dần;
 * - highlightPop: từ đang tới (t / per) phóng 1.15 quanh tâm, đổi màu nhấn;
 * - phụ đề `highlight: 'pop'`: từ đang nói phóng theo `caption.pop.scale`; the rest of its line moves aside.
 * Từ khoảng trắng không đếm.
 */
function wordTweaks(r: RNode, layout: TextLayout): (word: Word) => Tweak | null {
  const fx = r.wordFx;
  const pop = r.caption?.pop;
  if (!fx && !pop) return () => null;
  const index = new Map<Word, number>();
  let count = 0;
  for (const word of layout.words) if (word.chars.trim()) index.set(word, count++);
  // The spoken word grows around its centre by more than a space is wide at caption sizes, so
  // it ran into its neighbours ("hundredthousand"): the rest of its line moves aside as much.
  const grow = new Map<number, { x0: number; x1: number; by: number }>();
  if (pop && pop.scale > 1) {
    for (const word of layout.words) {
      if (!word.style.ranges.includes(pop.range) || !word.chars.trim()) continue;
      const span = grow.get(word.y);
      if (span) (span.x0 = Math.min(span.x0, word.x)), (span.x1 = Math.max(span.x1, word.x + word.width));
      else grow.set(word.y, { x0: word.x, x1: word.x + word.width, by: 0 });
    }
    for (const span of grow.values()) span.by = ((pop.scale - 1) * (span.x1 - span.x0)) / 2;
  }
  return (word) => {
    if (pop) {
      if (word.style.ranges.includes(pop.range)) return { dx: 0, dy: 0, scale: pop.scale, alpha: 1 };
      const span = grow.get(word.y);
      if (!span?.by) return null;
      const dx = word.x + word.width <= span.x0 + 0.5 ? -span.by : word.x >= span.x1 - 0.5 ? span.by : 0;
      return dx ? { dx, dy: 0, scale: 1, alpha: 1 } : null;
    }
    const i = index.get(word);
    if (!fx || i === undefined) return null;
    if (fx.type === 'wordSlide') {
      const length = Math.max(fx.per * 2, 8);
      const p = Math.min(1, Math.max(0, (fx.t - i * fx.per) / length));
      const e = 1 - (1 - p) ** 3;
      return fx.out ? { dx: 0, dy: -e * word.height * 0.6, scale: 1, alpha: 1 - e } : { dx: 0, dy: (1 - e) * word.height * 0.6, scale: 1, alpha: e };
    }
    if (fx.out) return null;
    const active = Math.floor(fx.t / fx.per);
    if (fx.t < 0 || active !== i || active >= count) return null;
    const p = Math.min(1, (fx.t - i * fx.per) / Math.min(fx.per, 5));
    return { dx: 0, dy: 0, scale: 1 + 0.15 * p, alpha: 1, color: fx.color };
  };
}

function strokeStyle(ctx: Ctx2D, stroke: Stroke, live: Lookup): void {
  ctx.lineWidth = live(stroke, 'width', 1);
  ctx.lineJoin = stroke.join ?? 'miter';
  ctx.lineCap = stroke.cap ?? 'butt';
  ctx.miterLimit = stroke.miterLimit ?? 10;
}

const dash = (mode: string) => mode.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

// ------------------------------------------------------------------ animation chữ

/** Hiện dần theo từ: `ratio` 0 → rỗng, 1 → đủ. Khoảng trắng sau từ cuối chưa hiện. */
export function revealWords(text: string, ratio: number): string {
  if (ratio >= 1) return text;
  if (ratio <= 0) return '';
  const pieces = text.split(/(\s+)/);
  const words = Math.ceil(pieces.length / 2);
  const shown = Math.floor(ratio * words);
  if (shown <= 0) return '';
  // Từ thứ k nằm ở vị trí 2k; lấy tới hết từ thứ `shown`, bỏ khoảng trắng theo sau.
  return pieces.slice(0, shown * 2 - 1).join('');
}

/** Reveal by user-perceived character, so an emoji or a decomposed "ễ" never shows half-drawn. */
export function revealChars(text: string, ratio: number): string {
  if (ratio >= 1) return text;
  if (ratio <= 0) return '';
  const chars = graphemes(text);
  return chars.slice(0, Math.floor(ratio * chars.length)).join('');
}

const SCRAMBLE_SET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!%#_';
/** Mỗi ký tự "chạy" trong 30% thời lượng; chữ đổi 30 lần trong cả animation. */
const ACTIVE = 0.3;
const REFRESHES = 30;

/**
 * Random characters settling left to right. Same rhythm as the fork: grapheme c of n settles at
 * `ceil((c · (1 − 0.3) / n + 0.3) · 30) / 30`; whitespace stays. The random characters differ: the
 * fork's hash was not ours to copy (clean-room) and nobody relies on it; the golden images only
 * compare settled text. Works per grapheme, so an emoji or a decomposed "ễ" is replaced or shown
 * whole; for ASCII that is per code unit, so the output is what it was before graphemes.
 */
export function scramble(text: string, ratio: number): string {
  if (!text.length) return '';
  if (ratio >= 1) return text;
  const step = Math.floor(ratio * REFRESHES);
  let seed = 0;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const chars = graphemes(text);
  let out = '';
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    const settle = Math.ceil(((index * (1 - ACTIVE)) / chars.length + ACTIVE) * REFRESHES) / REFRESHES;
    if (ratio >= settle || !char.trim()) {
      out += char;
      continue;
    }
    // Seeded shuffle: same text, position and tick → same character, so scrubbing back repeats it.
    let h = (seed + index * 7919 + step * 104729) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    out += SCRAMBLE_SET[((h ^ (h >>> 16)) >>> 0) % SCRAMBLE_SET.length];
  }
  return out;
}

