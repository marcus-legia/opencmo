/**
 * Filmstrip thumbnails for video bars on the timeline (plan 2026-11-15 B4).
 *
 * One hidden `<video>` per source, separate from the ones the preview plays, so grabbing never
 * seeks the picture the user is watching. Frames are grabbed one at a time in idle time, only for
 * the tiles on screen, and kept as small canvases. Times are rounded to a power-of-two step that
 * follows the zoom, so zooming in and back out reuses the same tiles.
 *
 * The video is not loaded with `crossOrigin`: a signed Storage URL without CORS headers would then
 * not load at all. The tiles are tainted, which is fine: they are only drawn, never read back.
 */

import type { AssetInput } from "@opencmo/clip-doc";

import type { BrowserMedia } from "../media";

/** Tiles kept per source; ~16 KB each at the default bar height. */
const KEEP = 400;
const MIN_STEP = 0.25;

/** Source seconds per tile, rounded up to a power of two so nearby zooms share tiles. */
export function filmstripStep(secondsPerTile: number): number {
  if (!(secondsPerTile > 0)) return MIN_STEP;
  return Math.max(MIN_STEP, 2 ** Math.ceil(Math.log2(secondsPerTile)));
}

const idle = (run: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 500 }) : window.setTimeout(run, 16);

class Grabber {
  private tiles = new Map<number, HTMLCanvasElement>();
  /** Tiles asked for, per bar: several bars of one source share this grabber. */
  private asks = new Map<string, number[]>();
  private busy = false;
  private listeners = new Set<() => void>();
  /** Bar height in CSS px the tiles are grabbed at. */
  private height = 34;
  aspect = 16 / 9;
  /** Tile shape: the video's own when landscape; a portrait video is cropped to a square. */
  get tileAspect(): number {
    return Math.max(1, this.aspect);
  }

  constructor(private video: HTMLVideoElement) {
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth && video.videoHeight) this.aspect = video.videoWidth / video.videoHeight;
      this.next();
    });
  }

  tile(at: number): HTMLCanvasElement | undefined {
    const found = this.tiles.get(at);
    if (found) {
      // Most recently used last, so the oldest tile is the first one dropped.
      this.tiles.delete(at);
      this.tiles.set(at, found);
    }
    return found;
  }

  /** The tiles bar `owner` shows now, replacing its earlier request; [] when it leaves the screen. */
  want(owner: string, times: number[], height: number): void {
    if (height > 0) this.height = height;
    if (times.length) this.asks.set(owner, times);
    else this.asks.delete(owner);
    this.next();
  }

  /** The next tile asked for and not grabbed yet. */
  private pending(): number | undefined {
    for (const times of this.asks.values()) for (const at of times) if (!this.tiles.has(at)) return at;
    return undefined;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private next(): void {
    if (this.busy || this.pending() === undefined || this.video.readyState < 1) return;
    this.busy = true;
    idle(() => void this.grab());
  }

  private async grab(): Promise<void> {
    const at = this.pending();
    if (at === undefined) return this.done();
    const video = this.video;
    const seconds = Math.min(at, Math.max(0, (video.duration || at) - 0.05));
    const seeked = new Promise<boolean>((resolve) => {
      const ok = () => finish(true);
      const fail = () => finish(false);
      const timer = window.setTimeout(fail, 4000);
      const finish = (value: boolean) => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", ok);
        video.removeEventListener("error", fail);
        resolve(value);
      };
      video.addEventListener("seeked", ok);
      video.addEventListener("error", fail);
    });
    video.currentTime = seconds;
    const grabbed = await seeked;
    if (grabbed) {
      const canvas = document.createElement("canvas");
      canvas.height = Math.max(1, Math.round(this.height * (window.devicePixelRatio || 1)));
      canvas.width = Math.max(1, Math.round(canvas.height * this.tileAspect));
      // Centre crop: a 9:16 frame squeezed into a 19 px sliver read as stripes.
      const vw = video.videoWidth || canvas.width;
      const vh = video.videoHeight || canvas.height;
      const sh = Math.min(vh, vw / this.tileAspect);
      canvas.getContext("2d")?.drawImage(video, 0, (vh - sh) / 2, vw, sh, 0, 0, canvas.width, canvas.height);
      this.tiles.set(at, canvas);
      while (this.tiles.size > KEEP) this.tiles.delete(this.tiles.keys().next().value!);
      for (const listener of this.listeners) listener();
    } else {
      // A frame that will not seek is not asked again until the bar asks afresh.
      for (const [owner, times] of this.asks) this.asks.set(owner, times.filter((time) => time !== at));
    }
    this.done();
  }

  private done(): void {
    this.busy = false;
    this.next();
  }
}

const grabbers = new Map<string, Promise<Grabber | null>>();

/** The grabber of a source, or null when it has no URL (nothing to show, not an error). */
export function grabberFor(key: string, src: AssetInput, media: BrowserMedia): Promise<Grabber | null> {
  let found = grabbers.get(key);
  if (!found) {
    found = media
      .urlOf(src)
      .then((url) => {
        if (!url) return null;
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.playsInline = true;
        video.src = url;
        return new Grabber(video);
      })
      .catch(() => null);
    grabbers.set(key, found);
  }
  return found;
}

export type { Grabber };
