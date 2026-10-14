/**
 * Frame nào của thẻ `<video>` ĐÃ hiện ra — qua `requestVideoFrameCallback`.
 *
 * Chromium vẽ được frame mới ngay khi `seeked`; Safari thì `seeked` có thể tới trước
 * khi frame được giải mã xong, và `drawImage` lúc đó vẽ frame CŨ (preview và
 * `capture`/`save_frame` lệch một nhịp). rVFC báo `mediaTime` của frame thật sự đã
 * hiện. Chỉ tin nó với thẻ đã từng báo ít nhất một lần: thẻ không gắn vào DOM có thể
 * không bao giờ nhận callback, và khi đó vẫn đi đường cũ (`seeked` + `currentTime`).
 */

type FrameMeta = { mediaTime: number };
type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, meta: FrameMeta) => void) => number;
};

const presented = new WeakMap<HTMLVideoElement, number>();
/** When (performance.now) the last frame was presented, and when the element last started seeking. */
const presentedAt = new WeakMap<HTMLVideoElement, number>();
const seekingAt = new WeakMap<HTMLVideoElement, number>();

/** Theo dõi frame đã hiện của một thẻ; `onFrame` chạy mỗi khi có frame mới (để vẽ lại). */
export function watchFrames(el: HTMLVideoElement, onFrame: () => void): void {
  const video = el as FrameVideo;
  if (typeof video.requestVideoFrameCallback !== "function") return;
  el.addEventListener("seeking", () => seekingAt.set(el, performance.now()));
  const next = () =>
    video.requestVideoFrameCallback!((now, meta) => {
      const first = !presented.has(el);
      const previous = presented.get(el);
      presented.set(el, meta.mediaTime);
      presentedAt.set(el, now);
      // Lúc đang phát, Playback tự vẽ theo đồng hồ; chỉ báo khi frame đổi lúc đứng yên.
      if (first || (el.paused && previous !== meta.mediaTime)) onFrame();
      next();
    });
  next();
}

/** Frame đang hiện có phải frame của giây `seconds` không. Không biết (không có rVFC) thì coi như có. */
export function framePresented(el: HTMLVideoElement, seconds: number, tolerance = 1 / 24): boolean {
  const shown = presented.get(el);
  if (shown === undefined) return true;
  return Math.abs(shown - seconds) <= tolerance;
}

/**
 * Source second the element is showing now: the last presented frame's `mediaTime`, carried forward
 * by the time since it was shown while playing. `currentTime` runs ahead of the picture when decoding
 * falls behind; this follows what is on screen. Falls back to `currentTime` without rVFC, while
 * seeking, or until a frame from after the last seek has been presented.
 */
export function shownTime(el: HTMLVideoElement): number {
  const shown = presented.get(el);
  const at = presentedAt.get(el);
  if (shown === undefined || at === undefined || el.seeking || at < (seekingAt.get(el) ?? 0)) return el.currentTime;
  if (el.paused) return shown;
  // Carry forward only across the gap between two frames. No new frame for longer means the element
  // stalled (buffering, decoder stuck): extrapolating would follow the clock and hide the stall from
  // the drift check, so report `currentTime`, which stops with the picture.
  const since = (performance.now() - at) / 1000;
  return since > MAX_CARRY_SECONDS ? el.currentTime : shown + since * el.playbackRate;
}

/** Longest gap between presented frames treated as normal playback (a 10 fps source still fits). */
const MAX_CARRY_SECONDS = 0.1;

/** Chờ frame kế tiếp hiện ra (tối đa `timeout` ms) — cho thẻ tạm của `media_grab`. */
export function nextFrame(el: HTMLVideoElement, timeout: number): Promise<void> {
  const video = el as FrameVideo;
  if (typeof video.requestVideoFrameCallback !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout);
    video.requestVideoFrameCallback!(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
