/**
 * Tool chạy trong tab của Assistant (spec agent-editor §4), cùng bộ vẽ với
 * preview và export — Assistant nhìn đúng thứ người dùng sẽ xuất ra:
 *
 * - `capture`: khung của clip ở các giây trên timeline bản xuất (sau cắt, từ
 *   đầu vùng làm việc), ghép thành MỘT contact sheet có mốc thời gian như tool
 *   `capture` của DS; `separate` thì trả tối đa 4 ảnh rời lớn hơn.
 * - `media_waveform`: đỉnh âm lượng + khoảng lặng của một file (mặc định video
 *   của clip), từ cùng sóng âm timeline đã giải (`loadPeaks`).
 * - `media_grab`: khung bên trong một video/ảnh của thư viện, dạng sheet.
 * - `inspect_color`: số liệu màu (điểm đen/trắng, cháy, ám màu, histogram) của một khung.
 */

import type { ClipDocument } from "@opencmo/clip-doc";
import { captureTimes, COLOR_GUIDE, createRenderer, scopeStats, visibleAt, withoutText, type LookBox, type MediaHost } from "@opencmo/clip-render";

import { framePresented, nextFrame } from "../frames";
import { keyOf } from "../media";
import { beatsOf, loadPeaks } from "../timeline/peaks";

export { withoutText };

/** Cạnh dài một ô của sheet: 12 ô dọc 9:16 ra ảnh ~800×1100 — đủ đọc chữ, nhỏ để gửi. */
const CELL_EDGE = 360;
/** Cạnh dài ảnh rời (`separate`). */
const SINGLE_EDGE = 768;
const WAIT_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Host = MediaHost & {
  preload(doc: ClipDocument): Promise<void>;
  bytesOf(src: string): Promise<Blob | null>;
  urlOf(src: string): Promise<string | null>;
};

export type ToolAnswer = { images?: string[]; data?: unknown; error?: string };

async function toBase64(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

const stamp = (seconds: number): string => {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(1).padStart(4, "0")}`;
};

/** Ghép các ô (cùng cỡ) thành một sheet, mỗi ô một nhãn giờ ở góc trái TRÊN (dưới là chỗ của phụ đề). */
async function sheet(cells: { canvas: OffscreenCanvas; label: string }[]): Promise<string> {
  const count = cells.length;
  const columns = count <= 4 ? count : count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / columns);
  const { width, height } = cells[0]!.canvas;
  const gap = 4;
  const out = new OffscreenCanvas(columns * width + (columns - 1) * gap, rows * height + (rows - 1) * gap);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#202020";
  ctx.fillRect(0, 0, out.width, out.height);
  const font = Math.max(12, Math.round(Math.min(width, height) / 12));
  cells.forEach((cell, index) => {
    const x = (index % columns) * (width + gap);
    const y = Math.floor(index / columns) * (height + gap);
    ctx.drawImage(cell.canvas, x, y);
    ctx.font = `600 ${font}px sans-serif`;
    const text = cell.label;
    const pad = Math.round(font / 3);
    const w = ctx.measureText(text).width + pad * 2;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(x, y, w, font + pad * 2);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(text, x + pad, y + pad);
  });
  return toBase64(out);
}

export type CaptureInput = {
  times?: number[];
  start?: number;
  end?: number;
  count?: number;
  separate?: boolean;
  grid?: boolean;
  /** Cạnh dài ảnh rời (mặc định 768); `save_frame` xin lớn hơn để model sinh có đủ chi tiết. */
  edge?: number;
};

/**
 * Lưới 0–1 mảnh trên ô (học `inspect_timeline` của Palmier §A4): model nói vị
 * trí bằng đúng hệ toạ độ 0–1 mà add_shape/add_text nhận, khỏi đoán theo pixel.
 */
function withGrid(source: OffscreenCanvas): OffscreenCanvas {
  // Bản sao sạch: renderer để lại transform/clip trên context của nó, kẻ thẳng lên đó là lệch.
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  const { width, height } = canvas;
  const font = Math.max(9, Math.round(Math.min(width, height) / 30));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = `600 ${font}px sans-serif`;
  ctx.textBaseline = "top";
  for (const t of [0.25, 0.5, 0.75]) {
    ctx.strokeStyle = t === 0.5 ? "rgba(0,255,255,0.45)" : "rgba(0,255,255,0.28)";
    const x = Math.round(t * width) + 0.5;
    const y = Math.round(t * height) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const label = String(t);
    const w = ctx.measureText(label).width + 4;
    // Nhãn x ở mép phải-trên của đường dọc; nhãn y ở mép phải của đường ngang (trái là nhãn giờ).
    // Nhãn x thấp hơn nhãn giờ của contact sheet (góc trái trên, cao ~1/12 cạnh ngắn).
    const top = Math.round(Math.min(width, height) / 12) * 2;
    ctx.fillRect(x + 1, top, w, font + 2);
    ctx.fillRect(width - w - 1, y + 1, w, font + 2);
    ctx.fillStyle = "rgba(0,255,255,0.95)";
    ctx.fillText(label, x + 3, top + 1);
    ctx.fillText(label, width - w + 1, y + 2);
  }
  ctx.restore();
  return canvas;
}

/** Thẻ đã tới đúng giây (host cộng 1ms) và khung đó đã giải mã xong. */
function settled(video: HTMLVideoElement, seconds: number): boolean {
  const target = Math.min(seconds, Number.isFinite(video.duration) ? video.duration : seconds);
  return (
    !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) <= 1 / 60 && framePresented(video, target)
  );
}

/**
 * `seek` dời playhead của editor tới khung đang chụp: preview và bản chụp dùng
 * chung thẻ video, nên cả hai phải muốn cùng một giây — không thì preview tua
 * thẻ về playhead giữa hai lượt chờ.
 */
/** Host bọc lại để biết lượt vẽ nào còn thiếu khung video/ảnh (đang tua). */
function trackingHost(media: Host): { host: MediaHost; missing: () => boolean; reset: () => void } {
  let missing = false;
  const host: MediaHost = {
    image: (src) => {
      const result = media.image(src);
      if (result === null) missing = true;
      return result;
    },
    video: (src, seconds) => {
      const result = media.video(src, seconds);
      // Host trả thẻ ngay khi vừa ra lệnh tua: preview vẽ lại lúc `seeked`, còn
      // bản chụp thì không — vẽ lúc đó là chụp khung CŨ. Lượt chạy thật đầu tiên
      // agent thấy người nói ở mọi ô trong khi bản export chỉ còn nền xanh.
      if (result === null || (result instanceof HTMLVideoElement && !settled(result, seconds))) missing = true;
      return result;
    },
    duration: (src) => media.duration(src),
    transcript: (src) => media.transcript?.(src) ?? null,
  };
  return { host, missing: () => missing, reset: () => (missing = false) };
}

/** Vẽ một khung, chờ tới khi đủ khung video/ảnh (tối đa WAIT_MS). */
async function drawSettled(render: () => void, tracking: ReturnType<typeof trackingHost>): Promise<void> {
  const started = Date.now();
  for (;;) {
    tracking.reset();
    render();
    if (!tracking.missing() || Date.now() - started > WAIT_MS) return;
    await sleep(60);
  }
}

export async function capture(document: ClipDocument, media: Host, input: CaptureInput, seek: (frame: number) => void): Promise<ToolAnswer> {
  await media.preload(document);
  const tracking = trackingHost(media);
  const { host } = tracking;
  const probe = createRenderer(document, host);
  const length = probe.range.frames / 30;
  const times = captureTimes(input, length);
  const separate = Boolean(input.separate) || times.length === 1;
  const picked = separate ? times.slice(0, 4) : times;
  const edge = separate ? Math.min(1920, input.edge ?? SINGLE_EDGE) : CELL_EDGE;
  const scale = edge / Math.max(probe.scene.width, probe.scene.height);
  const renderer = createRenderer(document, host, { scale });
  const cells: { canvas: OffscreenCanvas; label: string }[] = [];
  const grid = input.grid !== false;
  const layers: Array<{ time: number; visible: ReturnType<typeof visibleAt> }> = [];
  for (const time of picked) {
    const canvas = new OffscreenCanvas(Math.round(probe.scene.width * scale), Math.round(probe.scene.height * scale));
    const ctx = canvas.getContext("2d")!;
    // Never past the last frame of the export: a time at the very end would draw an empty frame.
    const frame = Math.min(renderer.range.start + Math.max(0, renderer.range.frames - 1), renderer.exportFrame(Math.max(0, time)));
    seek(frame);
    await drawSettled(() => renderer.render(ctx as never, frame), tracking);
    // Đo lớp bằng bộ đo chữ của chính canvas này (hộp chữ đúng như lúc vẽ), rồi mới kẻ lưới đè lên.
    layers.push({ time, visible: visibleAt(renderer.layout(frame, ctx as never) as unknown as LookBox[], frame, probe.scene) });
    cells.push({ canvas: grid ? withGrid(canvas) : canvas, label: stamp(time) });
  }
  const images = separate ? await Promise.all(cells.map((cell) => toBase64(cell.canvas))) : [await sheet(cells)];
  return {
    images,
    data: {
      times: picked,
      length: Math.round(length * 100) / 100,
      ...(grid ? { grid: "Cyan lines mark 0.25, 0.5 and 0.75 of the frame (x from the left, y from the top) — the same 0-1 coordinates add_shape, add_text and region take." } : {}),
      // Lớp nhìn thấy ở mỗi khung: id + hộp [x0, y0, x1, y1] 0–1, trên cùng trước.
      layers,
    },
  };
}

export type InspectColorInput = { time?: number; element_id?: string };

/**
 * `inspect_color` (E3, học Palmier): số liệu màu của khung như bản export, KHÔNG có
 * chữ/phụ đề (chữ trắng làm lệch điểm trắng). `element_id`: chỉ đo trong hộp của lớp đó.
 */
export async function inspectColor(document: ClipDocument, media: Host, input: InspectColorInput, playhead: number, seek: (frame: number) => void): Promise<ToolAnswer> {
  const clean = withoutText(document);
  await media.preload(clean);
  const tracking = trackingHost(media);
  const probe = createRenderer(clean, tracking.host);
  const length = probe.range.frames / 30;
  const time = Math.min(Math.max(0, input.time ?? playhead), Math.max(0, length - 1 / 30));
  const scale = 512 / Math.max(probe.scene.width, probe.scene.height);
  const renderer = createRenderer(clean, tracking.host, { scale });
  const width = Math.round(probe.scene.width * scale);
  const height = Math.round(probe.scene.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const frame = renderer.exportFrame(time);
  seek(frame);
  await drawSettled(() => renderer.render(ctx as never, frame), tracking);
  let region = [0, 0, 1, 1];
  if (input.element_id) {
    const layer = visibleAt(renderer.layout(frame, ctx as never) as unknown as LookBox[], frame, probe.scene).find((item) => item.id === input.element_id);
    if (!layer) return { error: `"${input.element_id}" is not visible at ${stamp(time)}. Pick a time when it is on screen (capture lists visible layers).` };
    region = layer.box;
  }
  const x = Math.floor(region[0]! * width);
  const y = Math.floor(region[1]! * height);
  const w = Math.max(1, Math.ceil(region[2]! * width) - x);
  const h = Math.max(1, Math.ceil(region[3]! * height) - y);
  const stats = scopeStats(ctx.getImageData(x, y, w, h).data);
  return { data: { time: Math.round(time * 100) / 100, ...(input.element_id ? { element_id: input.element_id, box: region } : {}), ...stats, guide: COLOR_GUIDE } };
}

export type WaveformInput = { path?: string; start?: number; end?: number; threshold_db?: number; min_silence?: number };

/**
 * Sóng âm của một file theo giây CỦA FILE: với video của clip đó là giây
 * nguồn, cùng thang với `get_transcript` và `remove_ranges`.
 */
export async function waveform(media: Host, input: WaveformInput, master: string, window: { start: number; end: number } | null): Promise<ToolAnswer> {
  const src = input.path ?? master;
  const peaks = await loadPeaks(keyOf(src), () => media.bytesOf(src));
  if (!peaks || !peaks.values.length) return { error: `No sound could be read from "${src}".` };
  const total = peaks.values.length / peaks.rate;
  const start = Math.max(0, input.start ?? (input.path ? 0 : (window?.start ?? 0)));
  const end = Math.min(total, input.end ?? (input.path ? total : (window?.end ?? total)));
  if (end <= start) return { error: "start must be before end, inside the file." };
  const threshold = input.threshold_db ?? -35;
  const minSilence = input.min_silence ?? 0.4;
  const db = (value: number) => (value > 0 ? 20 * Math.log10(value) : -120);

  const from = Math.floor(start * peaks.rate);
  const to = Math.ceil(end * peaks.rate);
  const silences: { start: number; end: number }[] = [];
  let quietFrom: number | null = null;
  for (let index = from; index <= to; index++) {
    const quiet = index < to && db(peaks.values[index] ?? 0) < threshold;
    if (quiet && quietFrom === null) quietFrom = index;
    if (!quiet && quietFrom !== null) {
      if ((index - quietFrom) / peaks.rate >= minSilence) {
        silences.push({ start: Math.round((quietFrom / peaks.rate) * 100) / 100, end: Math.round((index / peaks.rate) * 100) / 100 });
      }
      quietFrom = null;
    }
  }
  // 60 cột dB thô: đủ để thấy chỗ to/nhỏ, không phình tin nhắn.
  const buckets = 60;
  const span = (to - from) / buckets;
  const levels = Array.from({ length: buckets }, (_, bucket) => {
    let peak = 0;
    for (let index = Math.floor(from + bucket * span); index < Math.floor(from + (bucket + 1) * span); index++) {
      peak = Math.max(peak, peaks.values[index] ?? 0);
    }
    return Math.round(Math.max(-60, db(peak)));
  });
  return {
    data: {
      path: src,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      seconds_per_level: Math.round(((end - start) / buckets) * 1000) / 1000,
      levels_db: levels,
      threshold_db: threshold,
      silences,
      // Nhạc có nhịp (học Palmier §B7): BPM + beat trong khoảng đã hỏi, giây NGUỒN — đặt cắt/visual đúng phách.
      ...beatsIn(beatsOf(keyOf(src), peaks), start, end),
    },
  };
}

function beatsIn(grid: { bpm: number; beats: number[] } | null, start: number, end: number) {
  if (!grid) return {};
  const beats = grid.beats.filter((beat) => beat >= start && beat <= end);
  return { bpm: grid.bpm, beats: beats.slice(0, 64), ...(beats.length > 64 ? { beats_truncated: true } : {}) };
}

export type GrabInput = { path: string; times?: number[]; count?: number };

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error("This video could not be opened."));
    video.src = url;
  });
}

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  // Đăng ký chờ frame TRƯỚC khi tua: Safari có thể hiện frame mới sau `seeked`.
  const shown = nextFrame(video, 500);
  const seeked = new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = seconds;
    setTimeout(done, WAIT_MS);
  });
  return seeked.then(() => shown);
}

/** Khung bên trong một video/ảnh thư viện, theo giây của file, dạng sheet. */
export async function grab(media: Host, input: GrabInput, kind: string | null): Promise<ToolAnswer> {
  const url = await media.urlOf(input.path);
  if (!url) return { error: `"${input.path}" is not available on this device.` };
  if (kind === "IMAGE") {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.crossOrigin = "anonymous";
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This image could not be opened."));
      element.src = url;
    });
    const scale = SINGLE_EDGE / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = new OffscreenCanvas(Math.round(image.naturalWidth * scale), Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { images: [await toBase64(canvas)], data: { width: image.naturalWidth, height: image.naturalHeight } };
  }
  const video = await loadVideo(url);
  try {
    const duration = video.duration;
    const times = input.times?.length
      ? input.times.slice(0, 12).map((time) => Math.min(Math.max(0, time), Math.max(0, duration - 0.05)))
      : (() => {
          const count = Math.min(12, Math.max(1, input.count ?? 6));
          return Array.from({ length: count }, (_, index) => Math.round(((duration * (index + 0.5)) / count) * 100) / 100);
        })();
    const scale = CELL_EDGE / Math.max(video.videoWidth, video.videoHeight);
    const cells: { canvas: OffscreenCanvas; label: string }[] = [];
    for (const time of times) {
      await seekTo(video, time);
      const canvas = new OffscreenCanvas(Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale));
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      cells.push({ canvas, label: stamp(time) });
    }
    return {
      images: [await sheet(cells)],
      data: { times, duration: Math.round(duration * 100) / 100, width: video.videoWidth, height: video.videoHeight },
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
