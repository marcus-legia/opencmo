/**
 * Phụ đề và cắt bằng chữ trên document của clip.
 *
 * ## Trạng thái nằm trong document
 *
 * Cắt biến video master thành một `sequence` gồm các đoạn giữ lại. Thứ cần để
 * tính lại lượt cắt — transcript NGUỒN, cửa sổ nguồn, các khoảng đã xoá — là
 * mark `text-cut` của chính sequence đó:
 *
 *     { kind: 'sequence', marks: { 'text-cut': { transcript, window, removed } }, children: [video…] }
 *
 * Nằm trong document nghĩa là nó đi cùng mọi đường document đi qua: autosave và
 * khoá lạc quan, revision export, reset, khôi phục bản cũ. (Trong TSX của fork,
 * mark là comment `opencmo:text-cut` ở đầu sequence.)
 *
 * ## Keyframe không cần cắt
 *
 * `time` của keyframe tính theo NGUỒN, nên mỗi đoạn mang nguyên track của video
 * gốc và chỉ phát phần của nó.
 */

import type { CaptionsNode, ClipDocument, ClipNode, SequenceNode, TextCutMark, VideoNode } from '@opencmo/clip-doc';
import { FPS } from '@opencmo/clip-render';

import { activeView, assign, clone, copyOf, isMaster, nodes, sceneOf, walk, type Entity } from './doc';
import { faceXTrack, type FaceFrame, type XKey } from './face-track';
import { rebuildLayout } from './layout';
import { OpFailure } from './ops/context';
import { keptDuration, keptRanges, round, type Range } from './transcript';

export type CaptionState = {
  /** `src` của transcript NGUỒN — cái panel sửa; null khi clip không có `<captions>`. */
  base: string | null;
  /** Cửa sổ nguồn của clip: `sourceIn`/`sourceOut` của video trước khi cắt. */
  window: Range | null;
  /** Các khoảng nguồn đã xoá khỏi video. Rỗng là chưa cắt. */
  removed: Range[];
};

/**
 * J/L-cut (học Palmier `manage_clip_links`): dời điểm cắt TIẾNG ở một chỗ cắt, hình
 * giữ nguyên. Khoá = giây nguồn đầu đoạn SAU chỗ cắt (bền qua lượt cắt lại — đoạn còn
 * thì roll còn); giá trị d giây: d > 0 = L-cut (tiếng đoạn trước kéo sang hình đoạn
 * sau), d < 0 = J-cut (tiếng đoạn sau vào sớm, dưới hình đoạn trước).
 */
export type AudioRoll = Record<string, number>;

type CutMark = TextCutMark;

/** Khoá roll của chỗ cắt TRƯỚC đoạn bắt đầu ở giây nguồn `start`. */
export const rollKey = (start: number): string => String(round(start));

/** Đoạn giữ lại ngắn nhất còn lại sau khi dời tiếng (giây). */
const ROLL_KEEP = 0.1;

/**
 * Roll hợp lệ cho các đoạn `kept`: bỏ khoá không còn chỗ cắt (đoạn đã bị cắt mất), kẹp
 * để tiếng không vượt cửa sổ nguồn và không nuốt trọn một đoạn.
 */
export function activeRoll(kept: Range[], window: Range, roll: AudioRoll | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!roll) return out;
  for (let index = 1; index < kept.length; index++) {
    const value = roll[rollKey(kept[index]!.start)];
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
    const before = kept[index - 1]!;
    const after = kept[index]!;
    const limit =
      value > 0
        ? Math.min(after.end - after.start - ROLL_KEEP, window.end - before.end)
        : Math.min(before.end - before.start - ROLL_KEEP, after.start - window.start);
    const clamped = Math.sign(value) * Math.min(Math.abs(value), Math.max(0, limit));
    if (Math.abs(clamped) >= 1 / FPS) out.set(index, round(clamped));
  }
  return out;
}

/**
 * Phụ đề của một voiceover (mark `voiceover`): đọc transcript của GIỌNG MỚI, không
 * phải của video. Cắt bằng chữ, sửa từ, dời mốc chỉ đụng phụ đề của video
 * (spec voiceover §3) — nhầm hai thứ là cắt video theo chữ của giọng đọc.
 */
export const isVoiceoverCaptions = (node: ClipNode): boolean =>
  node.kind === 'captions' && Boolean((node as { marks?: Record<string, unknown> }).marks?.voiceover);

/** Video captions (not a voice-over's). */
const isVideoCaptions = (node: ClipNode): node is CaptionsNode => node.kind === 'captions' && !isVoiceoverCaptions(node);

/** Captions linked to a video element by `source`; unlinked video captions belong to the master. */
const linkedTo = (node: ClipNode): string | null => {
  const source = (node as { source?: unknown }).source;
  return isVideoCaptions(node) && typeof source === 'string' ? source : null;
};

function cutMark(node: ClipNode): CutMark | null {
  if (node.kind !== 'sequence') return null;
  const mark = node.marks?.['text-cut'] as Partial<CutMark> | undefined;
  return mark && typeof mark.transcript === 'string' && mark.window && Array.isArray(mark.removed)
    ? (mark as CutMark)
    : null;
}

type Paint = { type?: unknown; src?: unknown };

/** The video paint of a library video (a `rect` filled with a video, `nodeFor` in the web app). */
const videoPaint = (node: ClipNode): Paint | undefined =>
  node.kind === 'rect' ? ((node as { paints?: Paint[] }).paints ?? []).find((paint) => paint.type === 'video') : undefined;

/** A node that plays a video file with its sound: a `video`, or a rect painted with one. */
const isVideoMedia = (node: ClipNode): boolean => node.kind === 'video' || Boolean(videoPaint(node));

/** The file a video node plays. */
const mediaSrc = (node: ClipNode): unknown => (node.kind === 'video' ? (node as { src?: unknown }).src : videoPaint(node)?.src);

/** The segments of a cut (or the one uncut node): the master's videos, or any video media of another source. */
const videosIn = (root: ClipNode, master: boolean): VideoNode[] => {
  const out: VideoNode[] = [];
  const wanted = master ? isMaster : isVideoMedia;
  const visit = (node: ClipNode) => {
    if (wanted(node)) out.push(node as VideoNode);
    for (const child of [...((node as { masks?: ClipNode[] }).masks ?? []), ...((node as { children?: ClipNode[] }).children ?? [])]) {
      visit(child);
    }
  };
  for (const child of (root as { children?: ClipNode[] }).children ?? []) visit(child);
  return out;
};

type Located = {
  /** The node a cut replaces: the cut sequence, or the single video. */
  target: ClipNode;
  /** The video every segment is copied from. */
  template: VideoNode;
  mark: CutMark | null;
  window: Range | null;
  captions: CaptionsNode | undefined;
  /** The master video (`assets/master.mp4`): its cut drives the whole clip timeline. */
  master: boolean;
  /** Clip second where the video starts (0 for the master). */
  offset: number;
};

/** A video whose words can be read and cut: the master, or a video with a linked captions layer. */
export type SpeechSource = {
  elementId: string;
  name: string;
  captionsId: string | null;
  /** The SOURCE transcript the cut ops read; null while the video has no captions yet. */
  transcript: string | null;
  window: Range | null;
  master: boolean;
};

const startOf = (node: ClipNode): number => {
  const start = (node as { start?: unknown }).start;
  return typeof start === 'number' ? start : 0;
};

/** A located source, from its target (an uncut video or a cut sequence). */
function located(target: ClipNode, captions: CaptionsNode | undefined, master: boolean): Located | null {
  const mark = cutMark(target);
  if (mark) {
    const template = videosIn(target, master)[0];
    if (!template) return null;
    // A cut sequence has no `start`: its first segment starts where the video did.
    return { target, template, mark, window: mark.window, captions, master, offset: master ? 0 : startOf(template) };
  }
  const video = target as VideoNode;
  const start = typeof video.sourceIn === 'number' ? video.sourceIn : 0;
  // A library video placed from the library has no `sourceOut`, only its place on the timeline.
  const shown = typeof video.end === 'number' ? (video.end - startOf(video)) * (video.playbackRate ?? 1) : null;
  const end = typeof video.sourceOut === 'number' ? video.sourceOut : !master && shown !== null && shown > 0 ? round(start + shown) : undefined;
  return {
    target,
    template: video,
    mark: null,
    window: typeof end === 'number' ? { start, end } : null,
    captions,
    master,
    offset: master ? 0 : startOf(video),
  };
}

/** Every speech source of the document, the master first. */
function sources(document: ClipDocument): Located[] {
  const all = nodes(document);
  const out: Located[] = [];
  // The master: its cut sequence, or the master video itself.
  const masterTarget = all.find((node) => cutMark(node) && videosIn(node, true).length) ?? all.find(isMaster);
  if (masterTarget) {
    const id = (masterTarget as { id?: unknown }).id;
    const captions = all.find((node): node is CaptionsNode => isVideoCaptions(node) && (linkedTo(node) === null || linkedTo(node) === id));
    const found = located(masterTarget, captions, true);
    if (found) out.push(found);
  }
  const seen = new Set<string>();
  for (const captions of all) {
    const id = linkedTo(captions);
    if (id === null || seen.has(id)) continue;
    const target = all.find((node) => (node as { id?: unknown }).id === id);
    if (!target || target === masterTarget || !(cutMark(target) || isVideoMedia(target)) || isMaster(target)) continue;
    seen.add(id);
    const found = located(target, captions as CaptionsNode, false);
    if (found) out.push(found);
  }
  return out;
}

const sourceName = (found: Located): string => {
  const name = (found.target as { name?: unknown }).name ?? (found.template as { name?: unknown }).name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (found.master) return 'Main video';
  const src = mediaSrc(found.template);
  return typeof src === 'string' ? (src.split('/').pop() ?? src) : 'Video';
};

/**
 * Finds the video to read or cut by words.
 * - With `elementId`: that video, its cut sequence, or the cut sequence holding that segment.
 *   An id that names no speech source fails, whatever `strict` says.
 * - Without: the master; else the only speech source; else, when `strict`, an error naming them.
 */
function locate(document: ClipDocument, elementId?: string, strict = false): Located | null {
  const list = sources(document);
  if (elementId !== undefined) {
    const holds = (found: Located) =>
      (found.target as { id?: unknown }).id === elementId ||
      (found.mark !== null && videosIn(found.target, found.master).some((video) => (video as { id?: unknown }).id === elementId));
    const found = list.find(holds);
    if (found) return found;
    throw new OpFailure(`No video with id "${elementId}" has a transcript. Videos with speech: ${list.map((item) => `${sourceName(item)} (${String((item.target as { id?: unknown }).id ?? '')})`).join(', ') || 'none'}.`);
  }
  const master = list.find((item) => item.master);
  if (master) return master;
  if (list.length === 1) return list[0]!;
  if (list.length > 1 && strict) {
    throw new OpFailure(`This clip has several videos with speech: pass element_id (${list.map((item) => `${sourceName(item)}: ${String((item.target as { id?: unknown }).id ?? '')}`).join(', ')}).`);
  }
  return null;
}

/** The videos of the clip whose words can be read and cut (`element_id` of the transcript tools). */
export function speechSources(input: ClipDocument): SpeechSource[] {
  return sources(activeView(input)).map((found) => {
    const src = found.captions?.src;
    return {
      elementId: String((found.target as { id?: unknown }).id ?? ''),
      name: sourceName(found),
      captionsId: typeof found.captions?.id === 'string' ? found.captions.id : null,
      transcript: found.mark?.transcript ?? (typeof src === 'string' ? src : null),
      window: found.window,
      master: found.master,
    };
  });
}

/** The master video's captions (the layer the Transcript panel and text cuts edit); null if none. */
export function masterCaptions(document: ClipDocument): CaptionsNode | null {
  return locate(document)?.captions ?? null;
}

/** The J/L-cuts stored in the cut mark (empty when there are none). */
export function readCutRoll(document: ClipDocument, elementId?: string): AudioRoll {
  return locate(document, elementId)?.mark?.roll ?? {};
}

/** Mốc CLIP bắt đầu của từng đoạn giữ lại (cùng phép cộng theo frame như khi dựng). */
export function segmentStarts(kept: Range[]): number[] {
  return kept.map((_, index) => round(segmentStart(kept, index)));
}

/**
 * Captions and cut state of one speech source (`elementId`, or the default above); null when
 * there is none. `strict` turns "several sources, no id" into an error instead of null.
 */
export function readCaptionState(document: ClipDocument, elementId?: string, strict = false): CaptionState | null {
  const found = locate(activeView(document), elementId, strict);
  if (!found) return null;
  const src = found.captions?.src;
  const base = found.mark?.transcript ?? (typeof src === 'string' ? src : null);
  return { base, window: found.window, removed: found.mark?.removed ?? [] };
}

/** Clip second where a speech source starts: 0 for the master, a placed video's `start` otherwise. */
export function speechOffset(document: ClipDocument, elementId?: string): number {
  return locate(activeView(document), elementId)?.offset ?? 0;
}

/**
 * Một đoạn của video mẫu. Bỏ `id` trên video VÀ mọi thành phần phụ của nó: nhân
 * bản id là hai phần tử cùng tên, và lượt sửa kế tiếp theo tên đó trượt lặng lẽ.
 * Lượt stamp sau đặt tên mới.
 */
function segment(template: VideoNode, range: Range, start: number, face: FaceFrame | null): VideoNode {
  const copy = structuredClone(template) as unknown as Entity;
  const strip = (value: unknown, key?: string): void => {
    if (key === 'src' || key === 'marks') return;
    if (Array.isArray(value)) return value.forEach((item) => strip(item));
    if (!value || typeof value !== 'object') return;
    delete (value as Entity).id;
    for (const [inner, item] of Object.entries(value)) strip(item, inner);
  };
  strip(copy);
  copy.sourceIn = round(range.start);
  copy.sourceOut = round(range.end);
  // `sequence` không tự xếp các con nối đuôi: thiếu `start` thì mọi đoạn cùng
  // bắt đầu ở 0 và chỉ đoạn cuối còn thấy được.
  copy.start = round(start);
  // A library video carries its `end` (`nodeFor`): left as it was, every segment would run to the old end.
  // Counted in frames, as the renderer measures a segment and as the captions are timed.
  if (typeof copy.end === 'number') copy.end = round(start + segmentStart([range], 1));
  // The face-tracking track lives whole in the scene's `reframe` mark: a segment carries only the
  // keys around its own range, or a long clip cut many times outgrows the save limit.
  const track = face ? ((copy as unknown as VideoNode).tracks ?? []).find((item) => item.property === 'x') : undefined;
  const box = Number(copy.width);
  if (track && face && box > face.frameWidth) {
    const keys = faceXTrack(track.keyframes as unknown as XKey[], face, range, box);
    if (keys) track.keyframes = keys as typeof track.keyframes;
  }
  return copy as unknown as VideoNode;
}

/** The scene's face track, when the frame slides over the video to follow it. */
function faceFrame(document: ClipDocument): FaceFrame | null {
  const scene = sceneOf(document);
  const mark = scene?.marks?.reframe;
  if (!scene || !mark || (mark.mode ?? 'fill') !== 'fill' || mark.track.length < 2 || typeof scene.width !== 'number') return null;
  return { track: mark.track as [number, number][], frameWidth: scene.width };
}

const withoutMute = (video: VideoNode): VideoNode => {
  const copy = { ...video } as VideoNode & { muted?: boolean };
  delete copy.muted;
  return copy;
};

/**
 * Đoạn TIẾNG thứ `index` khi có J/L-cut: cùng nguồn với đoạn hình, hai đầu dời theo
 * roll của chỗ cắt trước/sau. Mang âm lượng, khử ồn và track `volume` của video mẫu
 * (mốc keyframe theo giây nguồn nên dùng chung được); `muted` thì không — video mẫu
 * câm vì CHÍNH J/L-cut này.
 */
function soundSegment(template: VideoNode, range: Range, kept: Range[], index: number, rolls: Map<number, number>, offset = 0): ClipNode {
  const lead = rolls.get(index) ?? 0;
  const trail = rolls.get(index + 1) ?? 0;
  const source = template as unknown as Entity;
  const tracks = ((source.tracks as Entity[] | undefined) ?? []).filter((track) => track.property === 'volume');
  const node: Entity = {
    kind: 'audio',
    src: mediaSrc(template as unknown as ClipNode),
    start: round(offset + segmentStart(kept, index) + lead),
    sourceIn: round(range.start + lead),
    sourceOut: round(range.end + trail),
    marks: { 'cut-audio': true },
  };
  for (const key of ['volume', 'denoise', 'playbackRate']) if (source[key] !== undefined) node[key] = source[key];
  // Every sound segment gets its own copy: the template's track ids would repeat once per segment.
  if (tracks.length) node.tracks = tracks.map(copyOf);
  return node as unknown as ClipNode;
}

/** Clip time → source time under `kept` (the clip as it was cut). */
function sourceAt(time: number, kept: Range[]): number {
  for (let index = 0; index < kept.length; index++) {
    const range = kept[index]!;
    const at = segmentStart(kept, index);
    if (time < at + (range.end - range.start) || index === kept.length - 1) return Math.min(range.end, range.start + Math.max(0, time - at));
  }
  return 0;
}

/** Source time → clip time under `kept`, snapped to the next kept moment (`forward`) or the last one. */
function clipAt(source: number, kept: Range[], forward: boolean): number | null {
  const order = forward ? kept.map((_, index) => index) : kept.map((_, index) => kept.length - 1 - index);
  for (const index of order) {
    const range = kept[index]!;
    const at = segmentStart(kept, index);
    if (source >= range.start && source <= range.end) return round(at + source - range.start);
    if (forward && source < range.start) return round(at);
    if (!forward && source > range.end) return round(at + range.end - range.start);
  }
  return null;
}

/**
 * Moves what sits on the clip timeline with the words under it when the cut changes: b-roll,
 * text, AI media, voice-overs, animations and layout ranges were placed in clip seconds, and a cut
 * earlier in the clip used to leave them over different words. Clip time is mapped back to source
 * time under the old cut and forward under the new one; what is left with nothing kept is removed.
 */
function followCut(document: ClipDocument, skip: Set<unknown>, before: Range[], after: Range[], ripple: Ripple | null = null): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  // A video that does not start the clip (a recording dropped into a blank edit): what sits before
  // it stays, what comes after it moves by the change in length, what is over it follows its words.
  const oldEnd = ripple ? ripple.offset + segmentStart(before, before.length) : 0;
  const delta = segmentStart(after, after.length) - segmentStart(before, before.length);
  const map = (time: number, forward: boolean): number | null => {
    if (!ripple) return clipAt(sourceAt(time, before), after, forward);
    if (time < ripple.offset) return time;
    if (time >= oldEnd - 1e-6) return round(time + delta);
    const at = clipAt(sourceAt(time - ripple.offset, before), after, forward);
    return at === null ? null : round(at + ripple.offset);
  };
  const move = (start: number, end: number | undefined): { start: number; end?: number } | null => {
    if (ripple && end !== undefined && end <= ripple.offset + 1e-6) return { start, end };
    if (ripple && start >= oldEnd - 1e-6) return { start: round(start + delta), ...(end === undefined ? {} : { end: round(end + delta) }) };
    const from = map(start, true);
    if (from === null) return null;
    if (end === undefined) return { start: from };
    const to = map(Math.max(start, end - 1e-6), false);
    if (to === null || to - from < 0.05) return null;
    return { start: from, end: Math.max(from, to) };
  };
  const visit = (list: Entity[]): Entity[] =>
    list.filter((entity) => {
      if (skip.has(entity) || isMaster(entity as unknown as ClipNode)) return true;
      // The speaker's captions are rebuilt from the cut transcript above; another video's linked
      // captions are re-timed from their video afterwards (`retimeLinked`).
      if (entity.kind === 'captions' && !isVoiceoverCaptions(entity as unknown as ClipNode)) return true;
      // Another video's cut moves as one piece: its segments keep their joins and match its mark.
      if (cutMark(entity as unknown as ClipNode)) {
        const children = (entity.children as Entity[] | undefined) ?? [];
        const first = Math.min(...children.map((child) => (typeof child.start === 'number' ? child.start : 0)));
        const at = move(first, undefined)?.start ?? first;
        for (const child of children) {
          if (typeof child.start === 'number') child.start = round(child.start + at - first);
          if (typeof child.end === 'number') child.end = round(child.end + at - first);
        }
        return true;
      }
      // A row (`B-roll 1`): its clips sit on the clip timeline themselves.
      if (entity.kind === 'sequence' && !entity.start && Array.isArray(entity.children)) {
        entity.children = visit(entity.children as Entity[]);
        return (entity.children as Entity[]).length > 0;
      }
      if (typeof entity.start !== 'number') return true;
      // Sound (a voice line, music) and a voice-over's captions keep their length and are never
      // dropped: trimming them would cut a sentence off. They move with where they start.
      if (entity.kind === 'audio' || entity.kind === 'captions') {
        const at = move(entity.start, undefined) ?? { start: map(entity.start, false) ?? 0 };
        if (typeof entity.end === 'number') entity.end = round(at.start + (entity.end - entity.start));
        entity.start = at.start;
        return true;
      }
      const moved = move(entity.start, typeof entity.end === 'number' ? entity.end : undefined);
      if (!moved) return false;
      entity.start = moved.start;
      if (moved.end !== undefined) entity.end = moved.end;
      return true;
    });
  const scene = sceneOf(document) as Entity | undefined;
  if (!scene) return;
  scene.children = visit((scene.children as Entity[] | undefined) ?? []);
  const layout = (scene.marks as { layout?: { ranges?: { start: number; end: number }[] } } | undefined)?.layout;
  if (layout?.ranges) {
    layout.ranges = layout.ranges.flatMap((range) => {
      const moved = move(range.start, range.end);
      return moved && moved.end !== undefined ? [{ ...range, start: moved.start, end: moved.end }] : [];
    });
  }
}

type Ripple = { offset: number };

/**
 * Linked captions follow their video after the timeline moved: same timing as the video, as when
 * they were attached. A video that the cut removed takes its captions with it.
 */
function retimeLinked(document: ClipDocument, skip: Set<unknown>): void {
  const all = nodes(document);
  const byElement = new Map(all.map((node) => [(node as { id?: unknown }).id, node] as const));
  const orphans: { entity: Entity; list: Entity[] }[] = [];
  walk(document, ({ entity, list }) => {
    if (skip.has(entity) || !list) return;
    const id = linkedTo(entity as unknown as ClipNode);
    if (id === null) return;
    const video = byElement.get(id) as Entity | undefined;
    if (!video) orphans.push({ entity, list });
    else if (video.kind !== 'sequence') for (const key of ['start', 'end']) assign(entity, key, video[key]);
    else {
      // A cut video: its captions start with its first segment and keep their length.
      const starts = ((video.children as Entity[] | undefined) ?? []).map((child) => child.start).filter((value): value is number => typeof value === 'number');
      if (!starts.length || typeof entity.start !== 'number') return;
      const shift = Math.min(...starts) - entity.start;
      entity.start = round(entity.start + shift);
      if (typeof entity.end === 'number') entity.end = round(entity.end + shift);
    }
  });
  for (const { entity, list } of orphans) list.splice(list.indexOf(entity), 1);
}

export type WriteCaptionState = {
  /** The speech source to write (`speechSources`); omitted = the default source. */
  elementId?: string;
  /** Transcript NGUỒN mà panel đang giữ (đường dẫn thư viện). */
  base: string | null;
  removed: Range[];
  /** J/L-cut; bỏ qua = giữ roll đang có (lượt cắt chữ không làm mất J/L-cut). */
  roll?: AudioRoll | null;
  /** Transcript theo thang OUTPUT cho `<captions>` khi có cắt, đã lưu. */
  cutTranscript?: string;
};

/** Thay `target` bằng `next` tại đúng chỗ của nó trong cây. */
function replaceNode(document: ClipDocument, target: ClipNode, next: ClipNode): void {
  walk(document, ({ entity, list }) => {
    if (entity === (target as unknown) && list) list[list.indexOf(entity)] = next as unknown as Entity;
  });
}

/**
 * Mốc bắt đầu của đoạn thứ `index`, cộng dồn THEO FRAME đúng như renderer đo
 * đuôi đoạn trước (`toFrames(sourceOut) − toFrames(sourceIn)`). Cộng dồn theo
 * giây rồi làm tròn từng mốc thì hai đoạn có thể hở nhau đúng một frame — một
 * chớp đen trong bản xuất mà không ai thấy trên timeline (eval AE0 bắt được).
 */
function segmentStart(kept: Range[], index: number): number {
  let frames = 0;
  for (const range of kept.slice(0, index)) frames += Math.round(round(range.end) * FPS) - Math.round(round(range.start) * FPS);
  // Mốc theo giây rơi đúng frame thì giữ nguyên (document không đổi so với trước).
  const seconds = keptDuration(kept.slice(0, index));
  return Math.round(round(seconds) * FPS) === frames ? seconds : frames / FPS;
}

/**
 * Writes the captions/cut state of one speech source. Always rebuilt from the source window and
 * the removed ranges, so the same input gives the same document.
 */
export function writeCaptionState(input: ClipDocument, state: WriteCaptionState): ClipDocument {
  const document = clone(input);
  const found = locate(document, state.elementId, true);
  if (!found?.window) throw new Error('This project has no clip video to edit.');
  const window = found.window;
  const kept = keptRanges(window, state.removed);
  if (!kept.length) throw new Error('That would remove the whole clip.');
  const cut = state.removed.length > 0;
  const offset = found.offset;

  const rolls = cut ? activeRoll(kept, window, state.roll === undefined ? found.mark?.roll : (state.roll ?? undefined)) : new Map<number, number>();
  const roll: AudioRoll = Object.fromEntries([...rolls].map(([index, value]) => [rollKey(kept[index]!.start), value]));
  // With a J/L-cut from the last pass the template is muted because of THAT cut, not by the user:
  // rebuild from an unmuted template and mute again if the J/L-cut is still there.
  const unmute = (video: VideoNode) => (found.mark?.roll && Object.keys(found.mark.roll).length ? withoutMute(video) : video);
  const template = unmute(found.template);
  // Each new segment starts from the old segment that showed most of the same source: a zoom, an
  // effect or a transition the user put on one segment stays on it instead of being replaced by
  // the first segment's.
  const olds = videosIn(found.target, found.master);
  if (!found.mark) olds.push(found.template);
  const overlap = (video: VideoNode, range: Range) =>
    Math.min(range.end, Number(video.sourceOut ?? range.end)) - Math.max(range.start, Number(video.sourceIn ?? range.start));
  const templateFor = (range: Range): VideoNode => {
    const best = olds.reduce<VideoNode | null>((pick, video) => (overlap(video, range) > (pick ? overlap(pick, range) : 0) ? video : pick), null);
    return best ? unmute(best) : template;
  };
  // The scene's face track follows the master's speaker; another video keeps its own framing.
  const face = found.master ? faceFrame(document) : null;
  const videos = kept.map((range, index) => segment(templateFor(range), range, offset + segmentStart(kept, index), face));
  // With a J/L-cut the picture is muted and the sound runs in `audio` segments of the same file,
  // with the moved cut points.
  const sounds = rolls.size ? kept.map((range, index) => soundSegment(template, range, kept, index, rolls, offset)) : [];
  if (rolls.size) for (const video of videos) (video as { muted?: boolean }).muted = true;
  const replacement: ClipNode = cut
    ? ({
        kind: 'sequence',
        marks: {
          'text-cut': { transcript: state.base ?? '', window, removed: state.removed, ...(rolls.size ? { roll } : {}) },
        },
        children: [...videos, ...sounds],
      } satisfies SequenceNode)
    : segment(template, window, offset, face);
  // A linked video keeps its id through every cut and restore: `element_id` and the captions'
  // `source` still name it afterwards. The old node leaves the tree, so the id stays unique. (The
  // master needs no id: it is the default source.)
  const id = (found.target as { id?: unknown }).id;
  if (!found.master && typeof id === 'string') (replacement as { id?: string }).id = id;
  replaceNode(document, found.target, replacement);
  const before = keptRanges(window, found.mark?.removed ?? []);
  // Only the clip's spine moves the rest of the timeline: the master, or a video in an edit that
  // has no master. A second video in a master clip is cut in place.
  const spine = found.master || !nodes(document).some(isMaster);
  if (spine) {
    const skip = new Set<unknown>([replacement, ...(found.captions ? [found.captions] : [])]);
    followCut(document, skip, before, kept, found.master ? null : { offset });
    retimeLinked(document, skip);
  }

  // After a cut the captions read the OUTPUT transcript from second 0 to the end of what is kept;
  // uncut they read the source transcript over the video's window.
  // Counted in frames like the segments: captions and an export area one frame longer than the
  // last segment are one black frame at the end of the export.
  const duration = cut ? segmentStart(kept, kept.length) : round(window.end - window.start);
  const captions = found.captions as Entity | undefined;
  if (captions) {
    const src = cut ? state.cutTranscript : state.base;
    if (src) captions.src = src;
    captions.start = round(offset);
    captions.sourceIn = cut ? 0 : round(window.start);
    captions.sourceOut = cut ? duration : round(window.end);
    if (!found.master && typeof captions.end === 'number') captions.end = round(offset + duration);
  }
  // The workarea decides what is exported: left as it was, the file is as long as the old clip.
  const scene = sceneOf(document) as Entity | undefined;
  if (scene?.workarea && found.master) scene.workarea = [0, duration];
  else if (spine && Array.isArray(scene?.workarea)) {
    const [from, to] = scene.workarea as [number, number];
    const length = segmentStart(before, before.length);
    if (to >= offset + length - 1e-3) scene.workarea = [from, round(Math.max(from, to + duration - length))];
  }
  // The split-layout panels cover exactly the new clip length.
  return rebuildLayout(document);
}

/**
 * Kiểu chữ của phụ đề — chung cho MỌI `<captions>` của clip (video, voiceover):
 * người dùng muốn một kiểu phụ đề, không phải mỗi lớp một kiểu. Vị trí
 * (verticalAlign/offset) không thuộc kiểu: phụ đề voiceover overlay cố ý nằm chỗ khác.
 */
export type CaptionStyle = {
  preset: string | null;
  colors: string[] | null;
  color?: string | null;
  fontFamily?: string | null;
  fontWeight?: number | null;
  fontScale?: number | null;
};

const STYLE_KEYS = ['color', 'fontFamily', 'fontWeight', 'fontScale'] as const;

/** Kiểu của `<captions>` (phụ đề video trước); null khi project không có phụ đề. */
export function readCaptionStyle(document: ClipDocument): CaptionStyle | null {
  const all = nodes(document);
  const captions = all.find(isVideoCaptions) ?? all.find((node): node is CaptionsNode => node.kind === 'captions');
  if (!captions) return null;
  const style: CaptionStyle = { preset: captions.preset ?? null, colors: captions.colors ? [...captions.colors] : null };
  for (const key of STYLE_KEYS) if (captions[key] !== undefined) (style as Record<string, unknown>)[key] = captions[key];
  return style;
}

/**
 * Đặt kiểu cho mọi `<captions>` (video và voiceover cùng một kiểu) và CHỈ thế —
 * áp brand không được đè nội dung. `preset`/`colors` luôn ghi; các khoá còn lại
 * chỉ ghi khi có mặt (null = về mặc định của preset, thiếu = giữ nguyên).
 * Project không có phụ đề thì trả nguyên document.
 */
export function writeCaptionStyle(input: ClipDocument, style: CaptionStyle): ClipDocument {
  const document = clone(input);
  const all = nodes(document).filter((node) => node.kind === 'captions') as unknown as Entity[];
  if (!all.length) return input;
  for (const captions of all) {
    assign(captions, 'preset', style.preset ?? undefined);
    assign(captions, 'colors', style.colors?.length ? [...style.colors] : undefined);
    for (const key of STYLE_KEYS) if (key in style) assign(captions, key, style[key] ?? undefined);
  }
  return document;
}


/**
 * Chỗ cắt của video chính theo giây CLIP, kèm J/L-cut đang có (giây; + = L, − = J) —
 * thứ agent cần để gọi `set_audio_roll`. Chưa cắt thì rỗng.
 */
export function cutPoints(document: ClipDocument, elementId?: string): { at: number; roll: number }[] {
  const state = readCaptionState(document, elementId);
  if (!state?.window) return [];
  const kept = keptRanges(state.window, state.removed);
  if (kept.length < 2) return [];
  const starts = segmentStarts(kept);
  const roll = activeRoll(kept, state.window, readCutRoll(document, elementId));
  const offset = speechOffset(document, elementId);
  return kept.slice(1).map((_, index) => ({ at: round(offset + starts[index + 1]!), roll: roll.get(index + 1) ?? 0 }));
}
