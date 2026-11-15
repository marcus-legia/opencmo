/**
 * Timeline zoom limits and memory (plan 2026-11-15 B1, report `docs/research/editor/2026-11-15-capcut-timeline.md`).
 *
 * Zoom is pixels per frame. The closest zoom is fixed; the farthest depends on the scene's length,
 * so Fit always fits: a fixed floor made a 30-minute edit wider than a 1440 px panel at its
 * farthest zoom.
 */

/** Closest zoom: one frame is 120 px. */
export const ZOOM_MAX = 120;
/** A very short clip can still zoom out to this; past it the bars are only a few pixels wide. */
const FAR_CAP = 0.1;
const FAR_FLOOR = 1e-4;

/**
 * Farthest zoom for a scene of `frames` frames in a lane `visible` px wide: the whole scene takes a
 * quarter of the lane, never less than 200 px (CapCut's rule).
 */
export function zoomFloor(frames: number, visible: number): number {
  if (!(frames > 0)) return FAR_CAP;
  return Math.min(FAR_CAP, Math.max(FAR_FLOOR, Math.max(200, visible / 4) / frames));
}

export function clampZoom(ppf: number, floor: number): number {
  return Math.min(ZOOM_MAX, Math.max(floor, ppf));
}

/**
 * Where zooming with a button, a key or the slider keeps still, in px from the lane's left edge:
 * the playhead when it is on screen, else the lane's centre. The wheel anchors on the pointer
 * instead (the caller passes it).
 */
export function zoomAnchor(playheadPx: number, scrollLeft: number, visible: number): number {
  const onScreen = playheadPx - scrollLeft;
  return onScreen >= 0 && onScreen <= visible ? onScreen : visible / 2;
}

const key = (scene: string) => `opencmo.timeline.zoom.${scene}`;

/** The zoom last used on this scene in this browser, or null. Storage can be blocked: never throws. */
export function rememberedZoom(scene: string | undefined): number | null {
  if (!scene) return null;
  try {
    const value = Number(window.localStorage.getItem(key(scene)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function rememberZoom(scene: string | undefined, ppf: number): void {
  if (!scene) return;
  try {
    window.localStorage.setItem(key(scene), String(Math.round(ppf * 1e6) / 1e6));
  } catch {
    // Private window or blocked storage: the zoom is only a convenience.
  }
}
