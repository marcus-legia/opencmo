/**
 * Speaker + visual layouts (spec visuals-2 L4): the frame split, the speaker in one band and a panel for visuals in
 * the other; or a visual-only scene (the panel covers everything, the speaker's voice runs on like B-roll).
 *
 * ## Why the master video's tracks are left alone
 *
 * The face-tracking `x` track runs on SOURCE time; cutting by words clones the video into pieces (`captions.ts`,
 * `segment`); a frame change overwrites x/y/w/h (`reframe.ts`). Writing the layout there would have three things
 * stepping on each other. So the master (the video, or the cut sequence) is wrapped in a "Speaker" group whose
 * `offsetY` track runs on CLIP time and moves the whole speaker frame into the band. A "Layout panel" rect right
 * above it covers the overflow: the panel grows in step with the move (same easing, at least as tall as the
 * move), so no gap ever shows.
 *
 * ## The mark is the source of truth
 *
 * The ranges live in the scene's `layout` mark (`{ ranges }`); `rebuildLayout` rebuilds the group, the panel and
 * every track from it, so any number of calls give one result, and a frame change calls it again to size the bands
 * for the new frame.
 *
 * ## PiP and side-by-side (learned from Palmier §C3)
 *
 * These two must SHRINK or CROP the speaker's frame, but a group's pivot is the centre of its children's bounding
 * box (the face-tracked video is wider than the frame, and its box moves with the `x` track), which cannot be
 * known ahead. So when the clip has a pip or side-by-side range, Speaker is a transparent RECT the size of the
 * frame (pivot = frame centre) carrying a mask: the mask cuts a square around the face (pip, rounded) or a column
 * (side-by-side), and the rect shrinks or moves it into the corner or half. PiP needs the speaker ON TOP of the
 * visual's ground, so a "Layout backdrop" rect goes under Speaker; the usual panel (above) is invisible during
 * pip. A clip with neither keeps the older structure (a group).
 */

import { FRAME_RATE, LAYOUT_ANCHORS, LAYOUT_MODES, type ClipDocument, type ClipNode, type LayoutRange as StoredRange } from '@opencmo/clip-doc';

import { captionPresetText, placeCaption } from '@opencmo/clip-render';

import { masterCaptions } from './captions';
import { clone, drawId, isMaster, nodes, sceneOf, type Entity } from './doc';
import { summarizeProject } from './summary';
import { round } from './transcript';

export { LAYOUT_ANCHORS, LAYOUT_MODES };
export type LayoutMode = (typeof LAYOUT_MODES)[number];
export type LayoutAnchor = (typeof LAYOUT_ANCHORS)[number];
/**
 * `cell` (E5, `apply_layout`): the speaker fits one cell [x, y, w, h] 0–1 of a multi-source layout; `focus` [x, y]
 * 0–1 picks the part of the frame kept (absent: centred across, around the face down). Not in `set_layout`: only
 * `apply_layout` writes it.
 */
export type LayoutRange = StoredRange;

/** Each mode's defaults: the ratio (band / PiP cell across the width / column) and the corner. */
export function layoutDefaults(mode: LayoutMode, aspect = 9 / 16): { ratio: number; anchor?: LayoutAnchor } {
  // A YouTube facecam is about a quarter of the width; a portrait frame needs a bigger cell to read the face.
  if (mode === 'pip') return { ratio: aspect >= 1 ? 0.24 : 0.36, anchor: 'bottom-right' };
  if (mode === 'side-by-side') return { ratio: 0.5, anchor: 'left' };
  return { ratio: 0.5 };
}

const PIP_CORNERS: LayoutAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const anchorFor = (range: LayoutRange): LayoutAnchor => {
  const fallback = layoutDefaults(range.mode === 'cell' ? 'full' : range.mode).anchor ?? 'left';
  if (!range.anchor) return fallback;
  if (range.mode === 'pip') return PIP_CORNERS.includes(range.anchor) ? range.anchor : fallback;
  return range.anchor === 'right' ? 'right' : 'left';
};
const FANCY = new Set<LayoutRange['mode']>(['pip', 'side-by-side', 'cell']);
const validRect = (rect: unknown): rect is [number, number, number, number] =>
  Array.isArray(rect) && rect.length === 4 && rect.every((value) => typeof value === 'number' && value >= 0 && value <= 1) && rect[2] > 0 && rect[3] > 0;
/** PiP margin from the frame's edge, as a share of the width. */
const PIP_MARGIN = 0.04;
/** PiP cell corner radius, as a share of the cell's side. */
const PIP_RADIUS = 0.14;

const FRAME = 1 / FRAME_RATE;
/** Transition, seconds; shorter when a range is too short. */
const TRANSITION = 0.3;
/** A range shorter than this is not worth splitting the frame for. */
export const MIN_RANGE = 0.5;
/** The panel colour: the visuals THEME's dark ground (`visuals/common.ts`), opaque to cover the overflow. */
const PANEL_COLOR = '#0F172A';
/** A speaker's face usually sits around 35% of the frame height (vertical frame, tracked across). */
const FACE_Y = 0.35;

const SPEAKER = 'speaker';
const PANEL = 'panel';
const BACKDROP = 'backdrop';

const aspectOf = (document: ClipDocument): number => {
  const scene = sceneOf(document);
  return scene?.width && scene?.height ? (scene.width as number) / (scene.height as number) : 9 / 16;
};

/**
 * Where the speaker's face is across the frame (0-1), for crops that cut a window out of the frame (pip, side
 * column). A master wider than the frame pans itself to the face (portrait frames), so the window stays centred;
 * on a landscape frame the master is not panned and the median of the face track places the window.
 */
export function speakerFocusX(document: ClipDocument): number {
  const scene = sceneOf(document);
  const W = Number(scene?.width ?? 0);
  const target = masterTarget(document) as unknown as Entity | undefined;
  const video = (target?.kind === 'sequence' ? ((target.children as Entity[] | undefined) ?? []).find((child) => child.kind === 'video') : target) as Entity | undefined;
  if (!W || !video || Number(video.width ?? W) > W * 1.01) return 0.5;
  const track = ((scene?.marks as { reframe?: { track?: [number, number][] } } | undefined)?.reframe?.track ?? []).map(([, focus]) => focus);
  if (!track.length) return 0.5;
  const sorted = [...track].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function readLayout(document: ClipDocument): LayoutRange[] {
  const scene = sceneOf(document);
  const ranges = (scene?.marks?.layout as { ranges?: unknown } | undefined)?.ranges;
  if (!Array.isArray(ranges)) return [];
  return ranges
    .filter(
      (item): item is LayoutRange =>
        !!item &&
        typeof item.start === 'number' &&
        typeof item.end === 'number' &&
        item.end > item.start &&
        ((LAYOUT_MODES as readonly string[]).includes(item.mode) ? item.mode !== ('full' as string) : item.mode === 'cell' && validRect(item.rect)),
    )
    .map((item) => {
      const out: LayoutRange = { ...item, ratio: typeof item.ratio === 'number' ? item.ratio : item.mode === 'cell' ? 1 : layoutDefaults(item.mode, aspectOf(document)).ratio };
      if (item.mode === 'cell' || !FANCY.has(item.mode) || !LAYOUT_ANCHORS.includes(item.anchor as LayoutAnchor)) delete out.anchor;
      if (item.mode !== 'cell') delete out.rect, delete out.focus, delete out.fit;
      else if (item.fit !== 'fit') delete out.fit;
      return out;
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * Writes a range into the list: the overlapping part of older ranges is cut away, and `full` only clears. Two
 * touching ranges of the same kind merge.
 */
export function mergeLayout(
  ranges: LayoutRange[],
  next: { start: number; end: number; mode: LayoutMode | 'cell'; ratio: number; anchor?: LayoutAnchor; rect?: [number, number, number, number]; focus?: [number, number]; fit?: 'fit'; background?: string },
): LayoutRange[] {
  const out: LayoutRange[] = [];
  for (const range of ranges) {
    if (range.end <= next.start || range.start >= next.end) out.push(range);
    else {
      if (range.start < next.start) out.push({ ...range, end: next.start });
      if (range.end > next.end) out.push({ ...range, start: next.end });
    }
  }
  if (next.mode !== 'full') {
    const range: LayoutRange = { start: next.start, end: next.end, mode: next.mode, ratio: next.ratio };
    if (next.background) range.background = next.background.toUpperCase();
    if (next.mode !== 'cell' && FANCY.has(next.mode) && next.anchor) range.anchor = next.anchor;
    if (next.mode === 'cell' && next.rect) {
      range.rect = next.rect;
      if (next.focus) range.focus = next.focus;
      if (next.fit) range.fit = next.fit;
    }
    out.push(range);
  }
  out.sort((a, b) => a.start - b.start);
  const merged: LayoutRange[] = [];
  for (const range of out) {
    const last = merged.at(-1);
    const sameCell = JSON.stringify([last?.rect, last?.focus, last?.fit]) === JSON.stringify([range.rect, range.focus, range.fit]);
    if (last && Math.abs(last.end - range.start) < 1e-6 && last.mode === range.mode && last.ratio === range.ratio && last.anchor === range.anchor && last.background === range.background && sameCell) last.end = range.end;
    else merged.push({ ...range });
  }
  return merged.filter((range) => range.end - range.start >= MIN_RANGE).map((range) => ({ ...range, start: round(range.start), end: round(range.end) }));
}

type Geometry = {
  offset: number;
  panelY: number;
  panelHeight: number;
  opacity: number;
  // Used only when the clip has pip/side-by-side (Speaker is a masked rect).
  offsetX: number;
  scale: number;
  maskX: number;
  maskY: number;
  maskW: number;
  maskH: number;
  radius: number;
  panelX: number;
  panelW: number;
  backdrop: number;
};

/** The speaker full frame with no panel: the resting part of every shape. */
const rest = (W: number, H: number) => ({ offsetX: 0, scale: 1, maskX: 0, maskY: 0, maskW: W, maskH: H, radius: 0, panelX: 0, panelW: W, backdrop: 0 });

/** The geometry once fully in the layout (`open`) and while the panel is still folded (`closed`). */
function geometry(range: LayoutRange, W: number, H: number, focusX = 0.5): { open: Geometry; closed: Geometry } {
  const base = rest(W, H);
  if (range.mode === 'visual-only') {
    return { open: { ...base, offset: 0, panelY: 0, panelHeight: H, opacity: 1 }, closed: { ...base, offset: 0, panelY: 0, panelHeight: H, opacity: 0 } };
  }
  if (range.mode === 'cell' && range.rect) {
    // A window of the cell's shape, the largest that fits the frame, around the face (or `focus`), scaled and moved into the cell.
    const [rx, ry, rw, rh] = range.rect;
    const cellW = rw * W;
    const cellH = rh * H;
    const aspect = cellW / cellH;
    const fit = range.fit === 'fit';
    // fit: the whole frame, scaled to fit the cell; fill: a window of the cell's shape, the largest that fits the frame.
    const maskW = fit || aspect < W / H ? (fit ? W : H * aspect) : W;
    const maskH = fit ? H : aspect >= W / H ? W / aspect : H;
    const [fx, fy] = range.focus ?? [0.5, NaN];
    const maskX = (W - maskW) * fx;
    const maskY = fit ? 0 : Number.isNaN(fy) ? Math.min(Math.max(FACE_Y * H - maskH * 0.4, 0), H - maskH) : (H - maskH) * fy;
    const scale = fit ? Math.min(cellW / W, cellH / H) : cellW / maskW;
    // fit with bars: the frame sits at the anchor point inside the cell.
    const [px, py] = fit ? (range.focus ?? [0.5, 0.5]) : [0.5, 0.5];
    const targetX = rx * W + (fit ? (cellW - W * scale) * px + (W * scale) / 2 : cellW / 2);
    const targetY = ry * H + (fit ? (cellH - H * scale) * py + (H * scale) / 2 : cellH / 2);
    const open: Geometry = {
      ...base,
      offset: round(targetY - H / 2 - scale * (maskY + maskH / 2 - H / 2)),
      offsetX: round(targetX - W / 2 - scale * (maskX + maskW / 2 - W / 2)),
      scale: round(scale),
      maskX: round(maskX),
      maskY: round(maskY),
      maskW: round(maskW),
      maskH: round(maskH),
      radius: 0,
      panelY: 0,
      panelHeight: 0,
      opacity: 0,
      backdrop: 0,
    };
    return { open, closed: { ...base, offset: 0, panelY: 0, panelHeight: 0, opacity: 0 } };
  }
  if (range.mode === 'pip') {
    // A square around the face (side = the frame's short side), shrunk into the corner; the usual panel is invisible, the backdrop is under it.
    const anchor = anchorFor(range);
    const side = Math.min(W, H);
    // Around the speaker's face (`speakerFocusX`): on a landscape frame the video is not panned, and a centred
    // square cut an off-centre speaker in half.
    const maskX = Math.min(Math.max(focusX * W - side / 2, 0), W - side);
    const maskY = Math.min(Math.max(FACE_Y * H - side / 2, 0), H - side);
    const screen = range.ratio * W;
    const scale = screen / side;
    const margin = PIP_MARGIN * W;
    const targetX = anchor.endsWith('right') ? W - margin - screen / 2 : margin + screen / 2;
    const targetY = anchor.startsWith('bottom') ? H - margin - screen / 2 : margin + screen / 2;
    const open: Geometry = {
      ...base,
      offset: round(targetY - H / 2 - scale * (maskY + side / 2 - H / 2)),
      offsetX: round(targetX - W / 2 - scale * (maskX + side / 2 - W / 2)),
      scale: round(scale),
      maskX: round(maskX),
      maskY: round(maskY),
      maskW: round(side),
      maskH: round(side),
      radius: round(side * PIP_RADIUS),
      panelY: 0,
      panelHeight: 0,
      opacity: 0,
      backdrop: 1,
    };
    return { open, closed: { ...base, offset: 0, panelY: 0, panelHeight: 0, opacity: 0 } };
  }
  if (range.mode === 'side-by-side') {
    // One column of the speaker, cut around their face (`speakerFocusX`); the panel covers the rest.
    const column = range.ratio * W;
    const left = anchorFor(range) === 'left';
    const maskX = Math.min(Math.max(focusX * W - column / 2, 0), W - column);
    const open: Geometry = {
      ...base,
      offset: 0,
      offsetX: round((left ? column / 2 : W - column / 2) - (maskX + column / 2)),
      maskX: round(maskX),
      maskW: round(column),
      panelX: round(left ? column : 0),
      panelW: round(W - column),
      panelY: 0,
      panelHeight: H,
      opacity: 1,
    };
    return { open, closed: { ...base, offset: 0, panelX: left ? W : 0, panelW: 0, panelY: 0, panelHeight: H, opacity: 1 } };
  }
  const band = H * range.ratio;
  // The window of the speaker's frame that fits the band, the face at ~40% of the band.
  const window = Math.min(Math.max(FACE_Y * H - band * 0.4, 0), H - band);
  if (range.mode === 'split-bottom') {
    // Band at the bottom: the panel is [0, H − band] and the speaker's frame moves down.
    return {
      open: { ...base, offset: round(H - band - window), panelY: 0, panelHeight: round(H - band), opacity: 1 },
      closed: { ...base, offset: 0, panelY: 0, panelHeight: 0, opacity: 1 },
    };
  }
  return {
    open: { ...base, offset: round(-window), panelY: round(band), panelHeight: round(H - band), opacity: 1 },
    closed: { ...base, offset: 0, panelY: H, panelHeight: 0, opacity: 1 },
  };
}

type Key = { time: number; value: number; easing?: string };
const key = (time: number, value: number): Key => ({ time: round(time), value: round(value), easing: 'easeInOut' });

/** Keyframes of the group and panel for every range; outside the ranges the panel is invisible (opacity 0). */
function keyframes(ranges: LayoutRange[], W: number, H: number, duration: number, focusX = 0.5) {
  const base = rest(W, H);
  const tracks = {
    offsetY: [key(0, 0)],
    y: [] as Key[],
    height: [] as Key[],
    opacity: [key(0, 0)],
    offsetX: [key(0, 0)],
    scale: [key(0, 1)],
    maskX: [key(0, base.maskX)],
    maskY: [key(0, base.maskY)],
    maskW: [key(0, base.maskW)],
    maskH: [key(0, base.maskH)],
    radius: [key(0, 0)],
    panelX: [key(0, 0)],
    panelW: [key(0, W)],
    backdrop: [key(0, 0)],
  };
  const push = (time: number, g: Geometry) => {
    const t = Math.min(Math.max(time, 0), duration);
    tracks.offsetY.push(key(t, g.offset));
    tracks.y.push(key(t, g.panelY));
    tracks.height.push(key(t, g.panelHeight));
    tracks.opacity.push(key(t, g.opacity));
    tracks.offsetX.push(key(t, g.offsetX));
    tracks.scale.push(key(t, g.scale));
    tracks.maskX.push(key(t, g.maskX));
    tracks.maskY.push(key(t, g.maskY));
    tracks.maskW.push(key(t, g.maskW));
    tracks.maskH.push(key(t, g.maskH));
    tracks.radius.push(key(t, g.radius));
    tracks.panelX.push(key(t, g.panelX));
    tracks.panelW.push(key(t, g.panelW));
    tracks.backdrop.push(key(t, g.backdrop));
  };
  let previous = -1;
  // Touching ranges of the same shape (split by a colour change) are one layout on screen: the panel stays open
  // across the seam instead of closing and opening again.
  const continues = (a: LayoutRange | undefined, b: LayoutRange | undefined) =>
    !!a && !!b && b.start - a.end < 2 * FRAME && JSON.stringify([a.mode, a.ratio, a.anchor, a.rect, a.focus, a.fit]) === JSON.stringify([b.mode, b.ratio, b.anchor, b.rect, b.focus, b.fit]);
  for (const [index, range] of ranges.entries()) {
    const next = ranges[index + 1];
    const { open, closed } = geometry(range, W, H, focusX);
    const T = Math.min(TRANSITION, (range.end - range.start) / 4);
    const hidden = { ...closed, opacity: 0 };
    if (continues(ranges[index - 1], range) || continues(range, next)) {
      if (!continues(ranges[index - 1], range)) {
        if (range.start < FRAME) push(0, open);
        else {
          if (range.start - FRAME > previous) push(range.start - FRAME, hidden);
          const joined = previous >= 0 && range.start - (previous - FRAME) < 2 * FRAME;
          push(joined ? Math.max(range.start, previous - FRAME) + FRAME / 2 : range.start, closed);
          push(range.start + T, open);
        }
      }
      if (!continues(range, next)) {
        if (range.end > duration - FRAME) push(duration, open);
        else {
          push(range.end - T, open);
          push(range.end, closed);
          if (range.end + FRAME <= duration && !(next && next.start - range.end < 2 * FRAME)) push(range.end + FRAME, hidden);
        }
      }
      previous = range.end + FRAME;
      continue;
    }
    // One frame before: the panel takes this range's folded shape while still invisible, so it does not
    // interpolate from the previous range's shape across the gap. A range touching the clip's start or end goes in
    // or out directly, with no slide on the first or last frame.
    const atStart = range.start < FRAME;
    const atEnd = range.end > duration - FRAME;
    if (!atStart && range.start - FRAME > previous) push(range.start - FRAME, hidden);
    // Right after the previous range: that range has folded to ITS shape at this moment, so this range's folded
    // shape goes half a frame later (both folded shapes cover nothing, so the switch is unseen). On the same key,
    // dedupe would drop the old folded shape and the previous range would slide straight into the new one, opening
    // a strip of panel when the two modes differ.
    const joined = previous >= 0 && range.start - (previous - FRAME) < 2 * FRAME;
    if (atStart) push(0, open);
    else {
      push(joined ? Math.max(range.start, previous - FRAME) + FRAME / 2 : range.start, closed);
      push(range.start + T, open);
    }
    if (atEnd) push(duration, open);
    else {
      push(range.end - T, open);
      push(range.end, closed);
    }
    // A next range starting right here takes care of its own folded shape.
    if (range.end + FRAME <= duration && !(next && next.start - range.end < 2 * FRAME)) push(range.end + FRAME, hidden);
    previous = range.end + FRAME;
  }
  // Keys at the same time (a range starting at 0, two touching ranges): keep the later one.
  const dedupe = (list: Key[]) => list.filter((item, index) => list.findLastIndex((other) => other.time === item.time) === index).sort((a, b) => a.time - b.time);
  return Object.fromEntries(Object.entries(tracks).map(([name, list]) => [name, dedupe(list)])) as Record<keyof typeof tracks, Key[]>;
}

const layoutRole = (node: Entity): string | undefined => (node.marks as { layout?: string } | undefined)?.layout;

/** The node cutting by words replaces: the sequence marked `text-cut`, or the single master video. */
function masterTarget(document: ClipDocument): ClipNode | undefined {
  const all = nodes(document);
  return all.find((node) => node.kind === 'sequence' && !!(node.marks as Record<string, unknown> | undefined)?.['text-cut']) ?? all.find(isMaster);
}

/** Whether the clip has a speaker the layouts can move (a master video, or the cut-by-words sequence). */
export function hasSpeaker(document: ClipDocument): boolean {
  return !!masterTarget(document);
}

type Located = { list: Entity[]; index: number };
function locateIn(root: Entity, target: Entity): Located | null {
  for (const key of ['children', 'masks']) {
    const list = (root[key] as Entity[] | undefined) ?? [];
    const index = list.indexOf(target);
    if (index >= 0) return { list, index };
    for (const child of list) {
      const found = locateIn(child, target);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Rebuilds the Speaker group and the panel from the mark, then places the captions for them. With no ranges left
 * the group is removed (the master goes back where it was) and the panel dropped. Does not change its input.
 */
export function rebuildLayout(input: ClipDocument): ClipDocument {
  return seatCaptions(rebuildPanels(input));
}

function rebuildPanels(input: ClipDocument): ClipDocument {
  const document = clone(input);
  const scene = sceneOf(document) as unknown as Entity | undefined;
  if (!scene || !scene.width || !scene.height) return document;
  const W = scene.width as number;
  const H = scene.height as number;
  const ranges = readLayout(document);
  const target = masterTarget(document) as unknown as Entity | undefined;

  // Undo the old state: the panel goes, the Speaker group gives its children back. The old nodes are kept for reuse
  // when the rebuild comes out the same, so ids stay and an op run again is "no change".
  const previous: Record<string, Entity> = {};
  // Where the backdrop was: a layer slipped between it and the speaker (an explainer placed behind a facecam)
  // must stay above it, or the opaque backdrop covers it on the next rebuild.
  let backdropAt: Located | null = null;
  const unwrap = (holder: Entity) => {
    for (const key of ['children', 'masks']) {
      const list = holder[key] as Entity[] | undefined;
      if (!list) continue;
      for (let index = list.length - 1; index >= 0; index--) {
        const node = list[index]!;
        const role = layoutRole(node);
        if (role === BACKDROP) backdropAt = { list, index };
        if (role === PANEL || role === BACKDROP) (previous[role] = node), list.splice(index, 1);
        else if (role === SPEAKER) (previous[SPEAKER] = node), list.splice(index, 1, ...((node.children as Entity[] | undefined) ?? []));
        else unwrap(node);
      }
    }
  };
  unwrap(scene);
  if (!ranges.length || !target) {
    if (scene.marks && (scene.marks as Record<string, unknown>).layout) {
      const { layout: _layout, ...rest } = scene.marks as Record<string, unknown>;
      scene.marks = Object.keys(rest).length ? rest : undefined;
      if (scene.marks === undefined) delete scene.marks;
    }
    return document;
  }

  const where = locateIn(scene, target);
  if (!where) return document;
  const workarea = scene.workarea as [number, number] | undefined;
  // No workarea: take the clip's real length. Taking the last range's end would make that range "touch the end of
  // the clip", and the speaker's frame would stay moved for good.
  const duration = workarea?.[1] ?? summarizeProject(document as unknown as ClipDocument).duration ?? Math.max(...ranges.map((range) => range.end));
  // Cutting words shortens the clip: a range past the end goes, one across the end is shortened; otherwise every
  // key piles up at the end and the panel slides across the whole clip.
  const live = ranges
    .map((range) => ({ ...range, end: Math.min(range.end, duration) }))
    .filter((range) => range.end - range.start >= MIN_RANGE);
  if (!live.length) return document;
  const tracks = keyframes(live, W, H, duration, speakerFocusX(document));
  const fancy = live.some((range) => FANCY.has(range.mode));
  const end = round(duration);
  // A constant track becomes a static value: a clip with only top/bottom splits carries no needless tracks.
  const animate = (entity: Entity, pairs: [string, Key[]][]) => {
    const list: { property: string; keyframes: Key[] }[] = [];
    for (const [property, keys] of pairs) {
      if (keys.every((item) => item.value === keys[0]!.value)) entity[property] = keys[0]?.value ?? 0;
      else list.push({ property, keyframes: keys }), (entity[property] = keys[0]!.value);
    }
    if (list.length) entity.tracks = list;
    return entity;
  };
  const group: Entity = fancy
    ? animate(
        {
          kind: 'rect',
          name: 'Speaker',
          marks: { layout: SPEAKER },
          // A rect without `end` lives 16 seconds (the renderer's default), its mask too.
          start: 0,
          end,
          width: W,
          height: H,
          masks: [
            animate({ kind: 'rect', name: 'Speaker mask', start: 0, end }, [
              ['x', tracks.maskX],
              ['y', tracks.maskY],
              ['width', tracks.maskW],
              ['height', tracks.maskH],
              ['cornerRadius', tracks.radius],
            ]),
          ],
          children: [target],
        },
        [
          ['offsetX', tracks.offsetX],
          ['offsetY', tracks.offsetY],
          ['scale', tracks.scale],
        ],
      )
    : {
        kind: 'group',
        name: 'Speaker',
        marks: { layout: SPEAKER },
        tracks: [{ property: 'offsetY', keyframes: tracks.offsetY }],
        children: [target],
      };
  const panel: Entity = {
    kind: 'rect',
    name: 'Layout panel',
    marks: { layout: PANEL },
    // A rect without `end` lives only 16 seconds (the renderer's default): it must cover the whole clip.
    start: 0,
    end,
    x: 0,
    y: tracks.y[0]?.value ?? 0,
    width: W,
    height: tracks.height[0]?.value ?? 0,
    opacity: 0,
    paints: [panelPaint(live)],
    tracks: [
      { property: 'y', keyframes: tracks.y },
      { property: 'height', keyframes: tracks.height },
      { property: 'opacity', keyframes: tracks.opacity },
    ],
  };
  if (fancy) {
    const sideways = animate({}, [
      ['x', tracks.panelX],
      ['width', tracks.panelW],
    ]);
    Object.assign(panel, { x: sideways.x, width: sideways.width });
    if (sideways.tracks) (panel.tracks as unknown[]).unshift(...(sideways.tracks as unknown[]));
  }
  const nodesOut: Entity[] = [reuse(previous[SPEAKER], group), reuse(previous[PANEL], panel)];
  if (live.some((range) => range.mode === 'pip')) {
    const backdrop = animate(
      {
        kind: 'rect',
        name: 'Layout backdrop',
        marks: { layout: BACKDROP },
        start: 0,
        end,
        x: 0,
        y: 0,
        width: W,
        height: H,
        paints: [panelPaint(live)],
      },
      [['opacity', tracks.backdrop]],
    );
    const kept = backdropAt as Located | null;
    if (kept?.list === where.list && kept.index < where.index) {
      where.list.splice(where.index, 1, ...nodesOut);
      where.list.splice(kept.index, 0, reuse(previous[BACKDROP], backdrop));
      return document;
    }
    nodesOut.unshift(reuse(previous[BACKDROP], backdrop));
  }
  where.list.splice(where.index, 1, ...nodesOut);
  return document;
}

/** Drops `id` at every level, to compare the content of two builds. */
function withoutIds(value: unknown, skip?: unknown): unknown {
  if (skip !== undefined && value === skip) return '§';
  if (Array.isArray(value)) return value.map((item) => withoutIds(item, skip));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id').map(([key, item]) => [key, withoutIds(item, skip)]));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  // Keys holding undefined are skipped, as JSON.stringify does.
  return `{${Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

/** The old node when its content (apart from ids and the master inside) is the same as the new one. */
function reuse(old: Entity | undefined, fresh: Entity): Entity {
  if (!old) return fresh;
  const inner = (fresh.children as Entity[] | undefined)?.[0];
  // Compared with sorted keys: Postgres jsonb reorders keys when it stores them.
  const same = stable(withoutIds({ ...old, children: fresh.children }, inner)) === stable(withoutIds(fresh, inner));
  return same ? { ...old, children: fresh.children } : fresh;
}

/** Writes the mark, then rebuilds. */
export function writeLayout(input: ClipDocument, ranges: LayoutRange[]): ClipDocument {
  const document = clone(input);
  const scene = sceneOf(document);
  if (!scene) return document;
  scene.marks = { ...scene.marks, layout: { ranges } };
  return rebuildLayout(document);
}

/**
 * The panel's area (0–1, with margins) at `time`, so a visual added during a layout lands inside the panel; null
 * when no layout shows then.
 */
export function panelRegionAt(document: ClipDocument, time: number): { x: number; y: number; width: number; height: number } | null {
  const range = readLayout(document).find((item) => time >= item.start - 1e-6 && time < item.end);
  if (!range || range.mode === 'cell') return null;
  if (range.mode === 'visual-only') return { x: 0.06, y: 0.08, width: 0.88, height: 0.84 };
  const scene = sceneOf(document);
  const aspect = scene?.width && scene?.height ? (scene.width as number) / (scene.height as number) : 9 / 16;
  if (range.mode === 'pip' && aspect >= 1) {
    // Landscape or square: the visual takes the side away from the corner cell, full height (a YouTube facecam).
    const cell = range.ratio + PIP_MARGIN * 2;
    const right = anchorFor(range).endsWith('right');
    const width = round(Math.max(0.3, 1 - cell - 0.08));
    // Up to 0.8 of the height: the captions sit under the visual on this side (`captionSpot`).
    return { x: right ? 0.05 : round(cell + 0.03), y: 0.08, width, height: 0.72 };
  }
  if (range.mode === 'pip') {
    // The visual sits above the speaker in z-order: it keeps clear of the whole strip with the PiP cell.
    const cell = round((range.ratio + PIP_MARGIN * 2) * aspect);
    return anchorFor(range).startsWith('bottom')
      ? { x: 0.06, y: 0.06, width: 0.88, height: round(Math.max(0.2, 1 - cell - 0.1)) }
      : { x: 0.06, y: round(cell + 0.04), width: 0.88, height: round(Math.max(0.2, 1 - cell - 0.1)) };
  }
  if (range.mode === 'side-by-side') {
    const rest = 1 - range.ratio;
    const left = anchorFor(range) === 'left' ? range.ratio : 0;
    return { x: round(left + rest * 0.06), y: 0.1, width: round(rest * 0.88), height: 0.8 };
  }
  const panel = 1 - range.ratio;
  const top = range.mode === 'split-bottom' ? 0 : range.ratio;
  // Visual on top: it stops short of the seam, where the captions sit (`captionSpot`).
  return { x: 0.06, y: round(top + panel * 0.1), width: 0.88, height: round(panel * (range.mode === 'split-bottom' ? 0.72 : 0.8)) };
}

/** The panel colour asked for at `time` (`set_layout { background }`), or null for the default dark panel. */
export function panelBackgroundAt(document: ClipDocument, time: number): string | null {
  const range = readLayout(document).find((item) => time >= item.start - 1e-6 && time < item.end);
  return range?.background ?? null;
}

/** The speaker's band (0–1) at `time`; null when the frame is not split, or in a visual-only scene. */
export function speakerBandAt(document: ClipDocument, time: number): { y: number; height: number } | null {
  const range = readLayout(document).find((item) => time >= item.start - 1e-6 && time < item.end);
  if (!range || range.mode === 'visual-only' || range.mode === 'pip' || range.mode === 'side-by-side' || range.mode === 'cell') return null;
  return range.mode === 'split-bottom' ? { y: 1 - range.ratio, height: range.ratio } : { y: 0, height: range.ratio };
}

/**
 * The panel's fill: one colour when every range shares it, else a colour track that switches at each range's start
 * (one frame before it, while the panel is still hidden; at the seam when it touches the range before), so a light
 * range next to a dark one never fades through grey on screen.
 */
function panelPaint(ranges: LayoutRange[]): Entity {
  const colours = ranges.map((range) => range.background ?? PANEL_COLOR);
  if (new Set(colours).size <= 1) return { type: 'solid', color: colours[0] ?? PANEL_COLOR };
  const keys: { time: number; value: string }[] = [];
  ranges.forEach((range, index) => {
    // A range touching the one before: that panel is still on screen one frame early, so switch at the seam.
    const touching = index > 0 && range.start - ranges[index - 1]!.end < 2 * FRAME;
    const at = touching ? range.start + FRAME / 4 : Math.max(0, range.start - FRAME);
    if (index > 0) keys.push({ time: round(Math.max(0, touching ? range.start : at - FRAME / 2)), value: colours[index - 1]! });
    keys.push({ time: round(at), value: colours[index]! });
  });
  return { type: 'solid', color: colours[0]!, tracks: [{ property: 'color', keyframes: keys.filter((key, i) => keys.findIndex((other) => other.time === key.time) === i) }] };
}

// ------------------------------------------------------------------ captions per layout

/** The tracks `seatCaptions` writes on the master captions: their ids start with this. */
export const CAPTION_TRACK = 'layout-caption-';
/** Caption centre above a split's seam, share of the frame height: inside the band the visual keeps clear. */
const SEAM_LIFT = 0.05;
/** Ink over a light panel, for captions and visuals alike: a near-black with a large lightness gap, never a mid grey. */
export const DARK_INK = '#15181E';

/** A panel colour light enough that the default light ink fades on it (Rec. 709 luma). */
export function isLightColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 >= 0.6;
}

/**
 * Where the captions' centre goes while a layout range shows (px), or null to leave them. Learned from AI
 * Producer's framing rules: the captions get their own place, never on the face and never across the visual.
 * - split: just above the seam (visual on top: the strip the visual keeps clear; visual below: the foot of the
 *   speaker's band);
 * - pip: under the visual on a landscape frame, centred on its side; above the cell's row on a vertical frame;
 * - side-by-side: the foot of the speaker's column.
 */
function captionSpot(range: LayoutRange, W: number, H: number): { x?: number; y: number } | null {
  if (range.mode === 'split-bottom') return { y: (1 - range.ratio) * H - SEAM_LIFT * H };
  if (range.mode === 'split-top') return { y: range.ratio * H - SEAM_LIFT * H };
  if (range.mode === 'pip') {
    const anchor = anchorFor(range);
    const cell = range.ratio * W;
    const margin = PIP_MARGIN * W;
    if (W >= H) {
      const right = anchor.endsWith('right');
      const visualLeft = right ? 0 : cell + margin * 2;
      const visualRight = right ? W - cell - margin * 2 : W;
      return { x: (visualLeft + visualRight) / 2, y: 0.88 * H };
    }
    return anchor.startsWith('bottom') ? { y: H - margin - cell - 0.04 * H } : { y: margin + cell + 0.06 * H };
  }
  if (range.mode === 'side-by-side') {
    const column = range.ratio * W;
    return { x: anchorFor(range) === 'left' ? column / 2 : W - column / 2, y: 0.86 * H };
  }
  return null;
}

/** Whether captions at this range's spot sit on the panel (or backdrop) rather than on the speaker's video. */
const captionsOnPanel = (range: LayoutRange): boolean => range.mode === 'split-bottom' || range.mode === 'pip' || range.mode === 'visual-only';

/**
 * Keys that take each range's value on the layout's 0.3 s moves and go back to `base` after. A range that runs
 * straight on into the next goes from its value to the next one's in one move, not back to `base` and out again.
 */
function rangeKeys<V>(entries: { range: LayoutRange; value: V }[], base: V, duration: number, local: (time: number) => number): { time: number; value: V }[] {
  const keys: { time: number; value: V }[] = [];
  entries.forEach(({ range, value }, index) => {
    const before = entries[index - 1];
    const after = entries[index + 1];
    const T = Math.min(TRANSITION, (range.end - range.start) / 4);
    if (range.start < FRAME) keys.push({ time: local(0), value });
    else if (before && range.start - before.range.end < 2 * FRAME) keys.push({ time: local(range.start + T), value });
    else keys.push({ time: local(range.start), value: base }, { time: local(range.start + T), value });
    if (range.end > duration - FRAME || (after && after.range.start - range.end < 2 * FRAME)) keys.push({ time: local(range.end), value });
    else keys.push({ time: local(range.end - T), value }, { time: local(range.end), value: base });
  });
  return keys.filter((key, index) => keys.findIndex((other) => other.time === key.time) === index).sort((a, b) => a.time - b.time);
}

/**
 * The clip's own captions move to their place for each layout range (`captionSpot`), on the layout's own 0.3 s
 * moves, and back after; over a light panel they also turn dark. The captions stay the editor's own layer and
 * style: only `offsetX`/`offsetY`/`color` tracks are added, and a hand-made offset is the user's choice of position
 * and stops the moves. Run after every layout or caption style change, so the tracks follow the current style.
 */
function seatCaptions(document: ClipDocument): ClipDocument {
  const scene = sceneOf(document) as unknown as Entity | undefined;
  const captions = masterCaptions(document) as unknown as Entity | null;
  if (!scene || !captions || !scene.width || !scene.height) return document;
  const tracks = ((captions.tracks as Entity[] | undefined) ?? []).filter((track) => !String(track.id ?? '').startsWith(CAPTION_TRACK));
  const own = tracks.some((track) => track.property === 'offsetY' || track.property === 'offsetX');
  const W = scene.width as number;
  const H = scene.height as number;
  const ranges = own ? [] : readLayout(document);
  const spots = ranges.flatMap((range) => {
    const spot = captionSpot(range, W, H);
    return spot ? [{ range, spot }] : [];
  });
  // The same clip length the panels are built on: a range that reaches the end holds there for both.
  const duration = (scene.workarea as [number, number] | undefined)?.[1] ?? summarizeProject(document).duration ?? Infinity;
  const baseY = Number(captions.offsetY ?? 0);
  const baseX = Number(captions.offsetX ?? 0);
  const box = placeCaption({ ...(captions as object), offsetY: 0, offsetX: 0 } as never, { width: W, height: H });
  // Caption keyframes run on the captions' own clock, as the renderer reads it: `sourceIn` + clip time × rate.
  const rate = typeof captions.playbackRate === 'number' && captions.playbackRate > 0 ? captions.playbackRate : 1;
  const local = (time: number) => round((time - Number(captions.start ?? 0)) * rate + Number(captions.sourceIn ?? 0));
  const written: { kind: string; property: string; keys: { time: number; value: number | string }[] }[] = [];
  for (const axis of ['y', 'x'] as const) {
    const base = axis === 'y' ? baseY : baseX;
    const centre = axis === 'y' ? box.y + box.height / 2 : box.x + box.width / 2;
    const entries = spots.map(({ range, spot }) => ({ range, value: spot[axis] === undefined ? base : round(spot[axis]! - centre) }));
    const keys = rangeKeys(entries, base, duration, local);
    if (keys.length && !keys.every((key) => key.value === base)) written.push({ kind: `offset${axis.toUpperCase()}`, property: axis === 'y' ? 'offsetY' : 'offsetX', keys });
  }
  // Caption ink (AI Producer's `ink` per caption window): where the captions sit on a light panel the preset's light
  // ink fades away, so they turn dark for that range. Over the speaker's video they keep it. Stark draws with a
  // difference blend and has no ink to change.
  const preset = captionPresetText((captions.preset as never) ?? 'classic');
  const ink = typeof captions.color === 'string' ? captions.color : preset.color;
  const light = ranges.filter((range) => range.background && isLightColor(range.background) && captionsOnPanel(range));
  if (ink && isLightColor(ink) && light.length && !tracks.some((track) => track.property === 'color')) {
    written.push({ kind: 'color', property: 'color', keys: rangeKeys(light.map((range) => ({ range, value: DARK_INK })), ink, duration, local) });
  }
  if (written.length) {
    // Unique across timelines: each has its own captions layer, named now if it has no id yet (the next stamp keeps it).
    if (typeof captions.id !== 'string') captions.id = drawId();
    for (const { kind, property, keys } of written) {
      // Stable ids: a layout op run again must leave the document unchanged.
      const id = `${CAPTION_TRACK}${kind}-${captions.id as string}`;
      tracks.push({ id, property, keyframes: keys.map((key, index) => ({ id: `${id}-${index}`, ...key })) });
    }
  }
  if (tracks.length) captions.tracks = tracks;
  else delete captions.tracks;
  return document;
}
