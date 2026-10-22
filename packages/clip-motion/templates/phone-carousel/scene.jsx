// Three-phone carousel: the stack opens, shifts one slot left twice with a capped overshoot and speed-linked
// blur, then the side phones step out and the hero settles. Ported from opus-pro/opusclip-video-tools
// remakes/opus-5.5/pf-phone-carousel (MIT, Copyright (c) 2026 OpusClip): same curves, overshoot cap, blur and
// recycling of the off-screen phone. The remake's drawn hiking app is replaced by three image slots, and the
// 1440x1080 layout is refitted to a 1080x1920 frame.
const SLOTS = {
  screens: ['screen-1', 'screen-2', 'screen-3'], // image names from kit.images, shown in this order on the hero phone
  background: '#EFF2ED',
};

const { Phone } = kit;
const { useCurrentFrame } = R;
const FPS = kit.fps;
const W = kit.width;
const H = kit.height;

const PHONE_W = Math.round(W * 0.4);
const CENTER_X = W / 2;
const CENTER_Y = H / 2;
const SIDE_SCALE = 0.78;
const SETTLED_HERO_SCALE = 1.03;
const SIDE_PUSH = 25;
// The remake keeps ~200 px between phones (pitch 490 for 330 px phones); in 9:16 that puts the side phones half
// off the frame, the usual portrait carousel look.
const SLOT_PITCH = Math.round(W * 0.52);
const MAX_OVERSHOOT_PX = 24;
const PEAK_BLUR = 4;
const POOL = 4; // three visible slots plus one staged off-screen right

const s = (sec) => Math.round(sec * FPS);
const TIMING = { openEnd: s(0.5), shifts: [{ start: s(1.0), end: s(1.65) }, { start: s(2.3), end: s(2.95) }], settle: { start: s(3.4), end: s(3.95) } };

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (n, m) => ((n % m) + m) % m;

// CSS cubic-bezier(x1, y1, x2, y2); y may leave [0, 1] (overshoot).
const cubicBezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)));
};

const shiftCurve = cubicBezier(0.8, 0, 0.5, 1.18);
let CURVE_PEAK = -Infinity;
for (let i = 0; i <= 2000; i++) CURVE_PEAK = Math.max(CURVE_PEAK, shiftCurve(i / 2000));
// Keep the natural overshoot, but never more than 24 px past the slot.
const OVERSHOOT_GAIN = Math.min(1, MAX_OVERSHOOT_PX / ((CURVE_PEAK - 1) * SLOT_PITCH));
const shiftProgress = (t) => {
  const p = shiftCurve(t);
  return p <= 1 ? p : 1 + (p - 1) * OVERSHOOT_GAIN;
};
const speed = (t) => Math.abs(shiftProgress(clamp(t + 1e-3)) - shiftProgress(clamp(t - 1e-3))) / 2e-3;
const SHIFT_FRAMES = TIMING.shifts[0].end - TIMING.shifts[0].start;
let PEAK_SPEED = 0;
for (let i = 0; i <= SHIFT_FRAMES; i++) PEAK_SPEED = Math.max(PEAK_SPEED, speed(i / SHIFT_FRAMES));
// Blur follows speed: 0 at rest, 4 px at the fastest rendered frame, 0 again on landing.
const shiftBlur = (t) => (t <= 0 || t >= 1 ? 0 : (PEAK_BLUR * speed(t) * clamp((1 - t) / 0.12)) / PEAK_SPEED);

const openCurve = cubicBezier(0.5, 0, 0.2, 1);
const openSpeed = (t) => Math.abs(openCurve(clamp(t + 1e-3)) - openCurve(clamp(t - 1e-3))) / 2e-3;
let OPEN_PEAK = 0;
for (let i = 0; i <= TIMING.openEnd; i++) OPEN_PEAK = Math.max(OPEN_PEAK, openSpeed(i / TIMING.openEnd));
const settleCurve = cubicBezier(0.25, 0.9, 0.3, 1);

const slotX = (k) => CENTER_X + (k - 1) * SLOT_PITCH;
const slotScale = (k) => (k === 1 ? 1 : SIDE_SCALE);
const shiftsDone = (f) => TIMING.shifts.filter((w) => f >= w.end).length;
const activeShift = (f) => TIMING.shifts.find((w) => f >= w.start && f < w.end);
// The hero walks screen 1 → 2 → 3; a phone changes screens only while parked off-screen.
const CONTENT_OFFSET = 2;

const phoneState = (e, f, screens) => {
  const done = shiftsDone(f);
  const k = mod(e - done, POOL);
  let x = slotX(k);
  let scale = slotScale(k);
  let y = CENTER_Y;
  let rotate = 0;
  let blur = 0;
  const a = activeShift(f);
  if (a) {
    const t = (f - a.start) / (a.end - a.start);
    const p = shiftProgress(t);
    x = lerp(slotX(k), slotX(k - 1), p);
    scale = lerp(slotScale(k), slotScale(k - 1), p);
    blur = shiftBlur(t);
  }
  // 0 → 0.5 s: the side phones fan out from behind the hero.
  if (done === 0 && f < TIMING.openEnd && k !== 3) {
    const ot = clamp(f / TIMING.openEnd);
    const o = openCurve(ot);
    const dir = k - 1;
    if (dir === 0) {
      scale = lerp(0.9, 1, o);
      y = lerp(CENTER_Y + 18, CENTER_Y, o);
    } else {
      x = lerp(CENTER_X + dir * 64, slotX(k), o);
      scale = lerp(0.72, SIDE_SCALE, o);
      y = lerp(CENTER_Y + 30, CENTER_Y, o);
      rotate = lerp(dir * 7, 0, o);
      blur = ot > 0 && ot < 1 ? (3 * openSpeed(ot)) / OPEN_PEAK : 0;
    }
  }
  // 3.4 → 3.95 s: the sides step out 25 px, the hero settles at 1.03.
  const q = settleCurve(clamp((f - TIMING.settle.start) / (TIMING.settle.end - TIMING.settle.start)));
  if (!a && q > 0) {
    if (k === 0) x -= SIDE_PUSH * q;
    if (k === 2) x += SIDE_PUSH * q;
    if (k === 1) scale = lerp(1, SETTLED_HERO_SCALE, q);
  }
  return { x, y, scale, rotate, blur, content: mod(k + done + CONTENT_OFFSET, screens) };
};

return function Scene() {
  const frame = useCurrentFrame();
  const screens = SLOTS.screens;
  const phones = Array.from({ length: POOL }, (_, e) => ({ e, ...phoneState(e, frame, screens.length) }));
  return (
    <R.AbsoluteFill style={{ background: SLOTS.background, overflow: 'hidden' }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          {phones.map((p) => (
            <filter key={p.e} id={`carousel-blur-${p.e}`} x="-40%" y="-25%" width="180%" height="150%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={`${(p.blur / p.scale).toFixed(3)} 0`} />
            </filter>
          ))}
        </defs>
      </svg>
      {phones.map((p) => (
        <div
          key={p.e}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: Math.round(p.scale * 1000),
            transformOrigin: `${CENTER_X}px ${CENTER_Y}px`,
            transform: `translate(${(p.x - CENTER_X).toFixed(3)}px, ${(p.y - CENTER_Y).toFixed(3)}px) rotate(${p.rotate.toFixed(3)}deg) scale(${p.scale.toFixed(5)})`,
            filter: p.blur > 0.05 ? `url(#carousel-blur-${p.e})` : undefined,
          }}
        >
          <Phone image={screens[p.content]} x={CENTER_X} y={CENTER_Y} w={PHONE_W} at={0} dur={1} />
        </div>
      ))}
    </R.AbsoluteFill>
  );
};
