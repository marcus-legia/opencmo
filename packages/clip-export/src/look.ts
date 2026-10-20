/**
 * Look at a clip on the server (plan item 10, Session B): the frames the in-app Assistant gets
 * from its browser tools (`apps/web/components/editor/assistant/capture.ts`), drawn here by the
 * same renderer the export uses, so Claude over MCP sees exactly what will be exported.
 *
 * - `capture`: frames at export-timeline seconds as one contact sheet (timecode per cell, the
 *   0.25/0.5/0.75 guides), plus the visible layers per frame, top first, with id and 0-1 box.
 * - `inspect_color`: colour numbers of one frame without text or captions (`scopeStats`).
 * - `grab`: frames inside a library video or image, as a sheet (ffmpeg, no renderer).
 * - `frame`: one large frame without text or captions, for `save_frame` (an image model would
 *   redraw any text it sees, garbled).
 *
 * Only the asked frames are decoded and drawn; nothing is encoded to video. Same inputs and
 * output shape as the browser tools, so guides and skills keep one vocabulary. Keep the two in
 * step when one changes.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { validate, type ClipDocument } from '@opencmo/clip-doc';
import { createRenderer, mediaSources, scopeStats, type MediaHost } from '@opencmo/clip-render';
import { z } from 'zod';

import { USER_INPUT } from './inputs.ts';
import { JobSchema, sourceKey } from './job.ts';
import { probe, type Probe } from './probe.ts';
import { loadHost, registerFonts } from './segment.ts';

const run = promisify(execFile);

/** Long edge of one sheet cell: 12 portrait cells come out near 800×1100, readable and small. */
const CELL_EDGE = 360;
const COLOR_EDGE = 512;
export const MAX_TIMES = 12;

export const LookSchema = JobSchema.pick({ document: true, media: true, transcripts: true, fonts: true, lottie: true, scene: true }).extend({
  op: z.enum(['capture', 'inspect_color', 'grab', 'frame']),
  times: z.array(z.number().min(0)).max(MAX_TIMES).optional(),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
  count: z.number().int().min(1).max(MAX_TIMES).optional(),
  grid: z.boolean().optional(),
  time: z.number().min(0).optional(),
  /** `frame`: long edge in pixels (the in-app save_frame asks 1280). */
  edge: z.number().int().min(256).max(1920).optional(),
  element_id: z.string().max(200).optional(),
  /** `grab`: the downloaded library file and its seconds. */
  file: z.string().min(1).optional(),
});
export type LookJob = z.infer<typeof LookSchema>;
export type LookResult = { images: string[]; data: Record<string, unknown> } | { error: string };

const stamp = (seconds: number): string => {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(1).padStart(4, '0')}`;
};

const jpeg = (canvas: Canvas) => canvas.encodeSync('jpeg', 80).toString('base64');

/** Equal cells into one sheet, a timecode at each cell's top left (captions sit at the bottom). */
function sheet(cells: { canvas: Canvas; label: string }[]): Canvas {
  const count = cells.length;
  const columns = count <= 4 ? count : count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / columns);
  const { width, height } = cells[0]!.canvas;
  const gap = 4;
  const out = createCanvas(columns * width + (columns - 1) * gap, rows * height + (rows - 1) * gap);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#202020';
  ctx.fillRect(0, 0, out.width, out.height);
  const font = Math.max(12, Math.round(Math.min(width, height) / 12));
  cells.forEach((cell, index) => {
    const x = (index % columns) * (width + gap);
    const y = Math.floor(index / columns) * (height + gap);
    ctx.drawImage(cell.canvas, x, y);
    ctx.font = `600 ${font}px sans-serif`;
    const pad = Math.round(font / 3);
    const w = ctx.measureText(cell.label).width + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, w, font + pad * 2);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(cell.label, x + pad, y + pad);
  });
  return out;
}

/** The 0-1 guides add_shape and add_text take, drawn on a clean copy of the cell. */
function withGrid(source: Canvas): Canvas {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const { width, height } = canvas;
  const font = Math.max(9, Math.round(Math.min(width, height) / 30));
  ctx.lineWidth = 1;
  ctx.font = `600 ${font}px sans-serif`;
  ctx.textBaseline = 'top';
  for (const t of [0.25, 0.5, 0.75]) {
    ctx.strokeStyle = t === 0.5 ? 'rgba(0,255,255,0.45)' : 'rgba(0,255,255,0.28)';
    const x = Math.round(t * width) + 0.5;
    const y = Math.round(t * height) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const label = String(t);
    const w = ctx.measureText(label).width + 4;
    const top = Math.round(Math.min(width, height) / 12) * 2;
    ctx.fillRect(x + 1, top, w, font + 2);
    ctx.fillRect(width - w - 1, y + 1, w, font + 2);
    ctx.fillStyle = 'rgba(0,255,255,0.95)';
    ctx.fillText(label, x + 3, top + 1);
    ctx.fillText(label, width - w + 1, y + 2);
  }
  return canvas;
}

type Box = { node: { id?: string; kind: string; text?: unknown; src?: unknown; name?: unknown }; visible: boolean; matrix: number[]; box: number[]; start: number; end: number };

/** Layers on screen at a frame, top first, with their 0-1 box of the frame. */
function visibleAt(boxes: Box[], frame: number, scene: { width: number; height: number }) {
  const out: Array<{ id: string; kind: string; label?: string; box: number[] }> = [];
  for (const item of boxes) {
    const { node } = item;
    if (!item.visible || !node.id || frame < item.start || frame >= item.end) continue;
    if (['group', 'sequence', 'scene', 'audio'].includes(node.kind)) continue;
    const [bx, by, bw, bh] = item.box as [number, number, number, number];
    if (!(bw > 0 && bh > 0)) continue;
    const [a, b, c, d, e, f] = item.matrix as [number, number, number, number, number, number];
    const corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
    const xs = corners.map((p) => p[0]! / scene.width);
    const ys = corners.map((p) => p[1]! / scene.height);
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    const rect = [clamp(Math.min(...xs)), clamp(Math.min(...ys)), clamp(Math.max(...xs)), clamp(Math.max(...ys))];
    if (rect[2]! <= rect[0]! || rect[3]! <= rect[1]!) continue;
    const raw = typeof node.text === 'string' ? node.text : typeof node.name === 'string' ? node.name : typeof node.src === 'string' ? node.src : '';
    out.push({ id: node.id, kind: node.kind, ...(raw ? { label: raw.trim().slice(0, 40) } : {}), box: rect });
  }
  return out.reverse().slice(0, 15);
}

/** The document without captions and text: white letters skew the white point. */
export function withoutText(document: ClipDocument): ClipDocument {
  const strip = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const record = node as { children?: unknown[]; stage?: unknown };
    if (record.stage) return { ...record, stage: strip(record.stage) };
    if (!Array.isArray(record.children)) return node;
    return {
      ...record,
      children: record.children
        .filter((child) => !(child && typeof child === 'object' && ['captions', 'text'].includes((child as { kind?: string }).kind ?? '')))
        .map(strip),
    };
  };
  return strip(document) as ClipDocument;
}

/** Seconds to draw: `times`, or `count` frames evenly spread over `[start, end)`. */
export function captureTimes(job: Pick<LookJob, 'times' | 'start' | 'end' | 'count'>, length: number): number[] {
  if (job.times?.length) return job.times.slice(0, MAX_TIMES);
  const start = Math.max(0, job.start ?? 0);
  const end = Math.min(length, job.end ?? length);
  const count = Math.max(1, Math.min(MAX_TIMES, job.count ?? 6));
  if (end <= start) return [start];
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, index) => Math.round((start + step * (index + 0.5)) * 100) / 100);
}

const COLOR_GUIDE =
  'black/median/white are luma 0-1 (healthy: black 0.02-0.06, white 0.9-0.98). clipped* = share of crushed or blown pixels (keep under 0.02 unless it is a stylistic choice). average = mean RGB: on a neutral scene a channel well above the others is a color cast. saturation 0-1 (natural footage ~0.1-0.3). histogram = 16 luma bins, dark to bright.';

async function probesOf(job: LookJob, document: ClipDocument): Promise<Record<string, Probe>> {
  const files = new Map(job.media.map((entry) => [sourceKey(entry.src), entry.file]));
  const probes: Record<string, Probe> = {};
  for (const { kind, src } of mediaSources(document)) {
    if (kind !== 'video' && kind !== 'audio') continue;
    const key = sourceKey(src);
    const file = files.get(key);
    if (file) probes[key] ??= await probe(file);
  }
  return probes;
}

/**
 * Draws the frames `pick` chooses from the export length (seconds), each into its own canvas of
 * long edge `edge`, with the layer boxes.
 */
async function drawFrames(job: LookJob, document: ClipDocument, pick: (length: number) => number[], edge: number) {
  registerFonts(job.fonts);
  const probes = await probesOf(job, document);
  const full = { ...job, document, out: '/dev/null', resolution: 1080 as const, crf: 18 };
  const { host, frames, current, loadImages } = await loadHost(full, probes);
  const planner = createRenderer(document, host as MediaHost, { scene: job.scene });
  const length = planner.range.frames / 30;
  const seconds = pick(length);
  const scale = edge / Math.max(planner.scene.width, planner.scene.height);
  const renderer = createRenderer(document, host as MediaHost, { scene: job.scene, scale });
  const width = Math.round(planner.scene.width * scale);
  const height = Math.round(planner.scene.height * scale);
  const drawn: { time: number; canvas: Canvas; layers: ReturnType<typeof visibleAt> }[] = [];
  try {
    for (const time of seconds) {
      const frame = renderer.exportFrame(Math.min(Math.max(0, time), Math.max(0, length - 1 / 30)));
      frames.beginFrame();
      current.clear();
      const needs = renderer.needs(frame);
      await loadImages(needs.filter((need) => need.kind === 'image').map((need) => sourceKey(need.src)));
      for (const need of needs) {
        if (need.kind !== 'video') continue;
        const key = sourceKey(need.src);
        current.set(`${key}@${need.seconds}`, await frames.frame(key, need.seconds));
      }
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      renderer.render(ctx as never, frame);
      drawn.push({ time, canvas, layers: visibleAt(renderer.layout(frame, ctx as never) as unknown as Box[], frame, planner.scene) });
    }
  } finally {
    frames.close();
  }
  return { drawn, length, times: seconds };
}

async function capture(job: LookJob): Promise<LookResult> {
  const document = validate(job.document);
  const { drawn, length, times } = await drawFrames(job, document, (total) => captureTimes(job, total), CELL_EDGE);
  const grid = job.grid !== false;
  const cells = drawn.map((item) => ({ canvas: grid ? withGrid(item.canvas) : item.canvas, label: stamp(item.time) }));
  return {
    images: [jpeg(sheet(cells))],
    data: {
      times,
      length: Math.round(length * 100) / 100,
      ...(grid ? { grid: 'Cyan lines mark 0.25, 0.5 and 0.75 of the frame (x from the left, y from the top) — the same 0-1 coordinates add_shape, add_text and region take.' } : {}),
      layers: drawn.map((item) => ({ time: item.time, visible: item.layers })),
    },
  };
}

async function inspectColor(job: LookJob): Promise<LookResult> {
  const document = withoutText(validate(job.document));
  const time = job.time ?? 0;
  const { drawn } = await drawFrames(job, document, () => [time], COLOR_EDGE);
  const item = drawn[0]!;
  const { width, height } = item.canvas;
  let region = [0, 0, 1, 1];
  if (job.element_id) {
    const layer = item.layers.find((entry) => entry.id === job.element_id);
    if (!layer) return { error: `"${job.element_id}" is not visible at ${stamp(time)}. Pick a time when it is on screen (capture_frame lists visible layers).` };
    region = layer.box;
  }
  const x = Math.floor(region[0]! * width);
  const y = Math.floor(region[1]! * height);
  const w = Math.max(1, Math.ceil(region[2]! * width) - x);
  const h = Math.max(1, Math.ceil(region[3]! * height) - y);
  const stats = scopeStats(item.canvas.getContext('2d').getImageData(x, y, w, h).data as unknown as Uint8ClampedArray);
  return { images: [], data: { time: Math.round(time * 100) / 100, ...(job.element_id ? { element_id: job.element_id, box: region } : {}), ...stats, guide: COLOR_GUIDE } };
}

async function frame(job: LookJob): Promise<LookResult> {
  const time = job.time ?? 0;
  const { drawn } = await drawFrames(job, withoutText(validate(job.document)), () => [time], job.edge ?? 1280);
  const item = drawn[0]!;
  return { images: [jpeg(item.canvas)], data: { time: Math.round(time * 100) / 100, width: item.canvas.width, height: item.canvas.height } };
}

/** Frames inside a library file. `-ss` before `-i` (input seeking), the demuxer allowlist on. */
async function grab(job: LookJob): Promise<LookResult> {
  if (!job.file) return { error: 'grab needs a file.' };
  const info = await probe(job.file);
  const still = !info.video || info.duration <= 0;
  const times = still ? [0] : captureTimes({ ...job, count: job.count ?? 6 }, info.duration);
  const cells: { canvas: Canvas; label: string }[] = [];
  for (const time of times) {
    const { stdout } = await run(
      'ffmpeg',
      ['-v', 'error', ...(still ? [] : ['-ss', String(Math.min(time, Math.max(0, info.duration - 0.05)))]), ...USER_INPUT, '-i', job.file,
        '-frames:v', '1', '-vf', `scale='if(gt(iw,ih),${CELL_EDGE},-2)':'if(gt(iw,ih),-2,${CELL_EDGE})'`, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
    );
    const image = await loadImage(stdout as unknown as Buffer);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    cells.push({ canvas, label: stamp(time) });
  }
  return { images: [jpeg(sheet(cells))], data: { times, duration: Math.round(info.duration * 100) / 100 } };
}

export async function lookJob(raw: unknown): Promise<LookResult> {
  const job = LookSchema.parse(raw);
  if (job.op === 'capture') return capture(job);
  if (job.op === 'inspect_color') return inspectColor(job);
  if (job.op === 'frame') return frame(job);
  return grab(job);
}

/** CLI helper: the job file the worker wrote. */
export const readLookJob = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
