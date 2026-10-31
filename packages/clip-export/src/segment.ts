/**
 * Vẽ một khoảng khung liên tục của bản xuất ra một file H.264 chỉ có hình.
 * Chạy trong worker thread (nhiều đoạn song song) hoặc ngay trong tiến trình
 * chính khi chỉ có một đoạn.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas';
import { FRAME_RATE as FPS } from '@opencmo/clip-doc';
import { createRenderer, FONTS, outputSize, parseCube, setFallbackFamilies, type CubeLut, type MediaHost, type Transcript } from '@opencmo/clip-render';

import { VideoFrames } from './decode.ts';
import { jobDocument, sourceKey, type Job } from './job.ts';
import type { Probe } from './probe.ts';

export type SegmentInput = {
  job: Job;
  probes: Record<string, Probe>;
  /** Khung scene đầu tiên và số khung của đoạn — đếm theo khung XUẤT (`fps`). */
  from: number;
  count: number;
  /**
   * Số khung/giây của bản xuất (E2-b, vắng = 30) và khung scene ứng với khung xuất 0.
   * Document luôn theo lưới 30: khung xuất j vẽ ở khung scene `start + j·30/fps` (lẻ được).
   */
  fps?: number;
  start?: number;
  file: string;
  threads: number;
};

let fontsLoaded: string | null = null;

/** Our own Latin font, always there (bundled): first after the brand font, see `setFallbackFamilies`. */
const LATIN_FALLBACK = 'OpenCMO Latin';
/** Scripts and emoji the brand fonts do not cover, when the export image has them (`modal_app.py`). */
const SCRIPT_FALLBACKS = ['Noto Sans CJK JP', 'Noto Sans Thai', 'Noto Sans Devanagari', 'Noto Color Emoji'];

export function registerFonts(dir: string) {
  if (fontsLoaded === dir) return;
  for (const [family, entry] of Object.entries(FONTS)) {
    for (const file of [entry.file, 'italic' in entry ? entry.italic : undefined]) {
      if (file) GlobalFonts.registerFromPath(join(dir, file), family);
    }
  }
  const latin = join(dir, 'DejaVuSans.ttf');
  if (existsSync(latin)) GlobalFonts.registerFromPath(latin, LATIN_FALLBACK);
  setFallbackFamilies([...(existsSync(latin) ? [LATIN_FALLBACK] : []), ...SCRIPT_FALLBACKS.filter((family) => GlobalFonts.has(family))]);
  fontsLoaded = dir;
}

/** Mọi thứ chỉ đọc mà renderer cần, dựng giống nhau ở mọi đoạn. */
export async function loadHost(job: Job, probes: Record<string, Probe>) {
  const files = new Map(job.media.map((entry) => [sourceKey(entry.src), entry.file]));
  const transcripts = new Map<string, Transcript>(
    job.transcripts.map((entry) => [entry.src, JSON.parse(readFileSync(entry.file, 'utf8')) as Transcript]),
  );
  const images = new Map<string, Image | 'failed'>();
  const frames = new VideoFrames(
    new Map(
      Object.entries(probes).flatMap(([key, probe]) => {
        const file = files.get(key);
        return file ? [[key, { file, probe }]] : [];
      }),
    ),
  );
  const current = new Map<string, unknown>();
  const luts = new Map<string, CubeLut | 'failed'>();
  const host: MediaHost = {
    image: (src) => (images.get(sourceKey(src)) as never) ?? 'failed',
    video: (src, seconds) => (current.get(`${sourceKey(src)}@${seconds}`) as never) ?? 'failed',
    duration: (src) => probes[sourceKey(src)]?.duration ?? null,
    transcript: (src) => transcripts.get(src) ?? null,
    canvas: (width, height) => createCanvas(width, height),
    lut: (src) => {
      if (!luts.has(src)) {
        const file = files.get(sourceKey(src));
        try {
          luts.set(src, file ? parseCube(readFileSync(file, 'utf8')) : 'failed');
        } catch {
          luts.set(src, 'failed');
        }
      }
      return luts.get(src)!;
    },
  };
  const loadImages = async (keys: Iterable<string>) => {
    for (const key of keys) {
      if (images.has(key)) continue;
      const file = files.get(key);
      images.set(key, file ? await loadImage(readFileSync(file)).catch(() => 'failed' as const) : 'failed');
    }
  };
  return { host, frames, current, loadImages };
}

/**
 * `canvas.data()` allocates a native 8 MB Buffer per 1080×1920 frame that V8 does not count in its heap: GC only
 * runs on JS garbage, so in scenes with little JS (video) hundreds of already-written buffers wait around
 * (measured 09-29: ~480 MB per segment). Collecting every `GC_EVERY` frames keeps the backlog under ~15 × 8 MB, at
 * ~1 ms each time.
 */
const GC_EVERY = 15;
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;

/** `onFrames(n)`: n more frames drawn and encoded, for the Export progress bar (10-02). */
export async function renderSegment(input: SegmentInput, onFrames: (count: number) => void = () => {}): Promise<void> {
  const { job, probes } = input;
  registerFonts(job.fonts);
  const document = jobDocument(job);
  const { host, frames, current, loadImages } = await loadHost(job, probes);
  const planner = createRenderer(document, host, { scene: job.scene });
  const size = outputSize(planner.scene, job.resolution);
  const renderer = createRenderer(document, host, { scene: job.scene, scale: size.scale });
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');

  const filters = [job.videoFilter, 'scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p'].filter(Boolean).join(',');
  const encoder = spawn(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      '-thread_queue_size', '2',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size.width}x${size.height}`, '-r', String(input.fps ?? FPS), '-i', 'pipe:0',
      '-vf', filters,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(job.crf), '-threads', String(input.threads),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      input.file,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  encoder.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()).length > 8192 && (stderr = stderr.slice(-8192)));
  const exited = once(encoder, 'close');

  try {
    const fps = input.fps ?? FPS;
    // 30 fps: khung xuất = khung scene, như trước (không làm tròn lại số nguyên nào).
    const sceneFrame = (index: number) => (fps === FPS ? index : (input.start ?? 0) + Math.round(((index - (input.start ?? 0)) * FPS * 1e6) / fps) / 1e6);
    for (let i = 0; i < input.count; i++) {
      const frame = sceneFrame(input.from + i);
      frames.beginFrame();
      current.clear();
      const needs = renderer.needs(frame);
      await loadImages(needs.filter((need) => need.kind === 'image').map((need) => sourceKey(need.src)));
      for (const need of needs) {
        if (need.kind !== 'video') continue;
        const key = sourceKey(need.src);
        current.set(`${key}@${need.seconds}`, await frames.frame(key, need.seconds));
      }
      renderer.render(ctx, frame);
      if (!encoder.stdin.write(canvas.data())) await once(encoder.stdin, 'drain');
      onFrames(1);
      if (i % GC_EVERY === GC_EVERY - 1) collect();
    }
    encoder.stdin.end();
    const [code] = await exited;
    if (code !== 0) throw new Error(`ffmpeg mã hoá đoạn ${input.from} lỗi (${code}): ${stderr.trim()}`);
  } finally {
    frames.close();
    if (encoder.exitCode === null) encoder.kill('SIGKILL');
  }
}
