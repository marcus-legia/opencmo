/**
 * The landing background: a 12px lattice where slow value noise grows "islands" of
 * squares, dots and rings in the brand colour. Islands are kept to the left and right
 * edges so body copy always sits on plain paper. A click on empty page sends a ripple
 * through the lattice.
 *
 * Drawn on a canvas at runtime rather than shipped as an image: ~0 bytes to download,
 * and it can move. With reduced motion it paints one still frame and stops.
 */

const CELL = 12;
const FRAME_MS = 1000 / 30;
const RIPPLE_LIFE = 2.6;
const RIPPLE_SPEED = 260;

// Deterministic per-cell hash, so a cell keeps its decoration while the islands drift.
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

type Ripple = { x: number; y: number; age: number };

export function startPixelField(canvas: HTMLCanvasElement, reduced: boolean): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const style = getComputedStyle(canvas);
  const brand = style.getPropertyValue("--brand").trim() || "#ef4a1a";
  const paper = style.getPropertyValue("--paper").trim() || "#f3f3ee";
  const ripples: Ripple[] = [];
  let width = 0, height = 0, drift = 0, raf = 0, last = 0, drawn = 0;

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
  };

  const onRipple = (cx: number, cy: number) => {
    for (const r of ripples) {
      const ring = Math.abs(Math.hypot(cx - r.x, cy - r.y) - r.age * RIPPLE_SPEED);
      if (ring < CELL * 1.2) return true;
    }
    return false;
  };

  function draw() {
    ctx!.clearRect(0, 0, width, height);
    ctx!.fillStyle = brand;
    ctx!.strokeStyle = brand;
    ctx!.lineWidth = 1.2;
    const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
    // Islands live only in the side margin: outside the 1240px content column, or inside
    // the page gutter (`--gutter` in landing.css) when the screen is narrower than that.
    const gutter = Math.min(56, Math.max(20, width * 0.04));
    const zone = Math.max((width - 1240) / 2, gutter) - 10;
    for (let gx = 0; gx < cols; gx++) {
      const x = gx * CELL + CELL / 2;
      // A margin under ~2 cells only reads as a stray line; phones keep just the ripples.
      const pull = zone < 24 ? 0 : 1 - Math.min(x, width - x) / zone;
      for (let gy = 0; gy < rows; gy++) {
        const px = gx * CELL, py = gy * CELL, cx = px + CELL / 2, cy = py + CELL / 2;
        if (ripples.length && onRipple(cx, cy)) {
          ctx!.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
          continue;
        }
        if (pull <= 0) continue;
        const n = noise(gx * 0.09 + drift, gy * 0.09 - drift * 0.4) + pull * 0.35;
        if (n < 0.76) continue;
        const pick = hash(gx, gy);
        if (n > 0.94) {
          ctx!.fillRect(px, py, CELL + 0.5, CELL + 0.5);
          if (pick < 0.1) {
            ctx!.fillStyle = paper;
            ctx!.beginPath();
            ctx!.arc(cx, cy, CELL * 0.17, 0, Math.PI * 2);
            ctx!.fill();
            ctx!.fillStyle = brand;
          }
        } else if (pick < 0.32) {
          ctx!.fillRect(cx - 1, cy - 1, 2, 2);
        } else if (pick < 0.46) {
          ctx!.beginPath();
          ctx!.arc(cx, cy, CELL * 0.3, 0, Math.PI * 2);
          ctx!.fill();
        } else if (pick < 0.56) {
          ctx!.beginPath();
          ctx!.arc(cx, cy, CELL * 0.3, 0, Math.PI * 2);
          ctx!.stroke();
        } else if (pick < 0.64) {
          ctx!.fillRect(cx - 3, cy - 3, 6, 6);
        }
      }
    }
  }

  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(t - last, 100) / 1000 : 0;
    last = t;
    drift += dt * 0.05;
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > RIPPLE_LIFE) ripples.splice(i, 1);
    }
    if (t - drawn < FRAME_MS) return;
    drawn = t;
    draw();
  };

  const run = () => {
    if (reduced) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  // Only clicks on empty page: a click on a button or form already has its own feedback.
  const onPointer = (e: PointerEvent) => {
    if (reduced || (e.target as Element | null)?.closest("a, button, input, textarea, label, select, [role]")) return;
    if (ripples.length >= 6) ripples.shift();
    ripples.push({ x: e.clientX, y: e.clientY, age: 0 });
  };

  resize();
  run();
  window.addEventListener("resize", resize);
  window.addEventListener("pointerdown", onPointer);
  document.addEventListener("visibilitychange", run);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointerdown", onPointer);
    document.removeEventListener("visibilitychange", run);
  };
}
