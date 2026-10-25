// Headline snap: three big words snap in from the right one row after another with a capped overshoot and a
// speed smear, hold, then the whole set is pushed out left while a second set snaps in behind a feathered seam.
// Ported from opus-pro/opusclip-video-tools remakes/opus-5.5/pf-type-snap (MIT, Copyright (c) 2026 OpusClip):
// same curves, distances, staggers and smear; laid out for 9:16 (the remake is 1080x1350), Inter for Geist, and the
// words, labels and colours are slots.
const SLOTS = {
  first: 'MAKE|SOMETHING|MATTER.', // three words split by |; the last one takes the accent
  second: 'IDEAS|INTO|ACTION.', // the set that replaces it
  label: 'FIELD DAYS', // top label
  footer: 'OCT 24-25', // bottom line, first part (bright)
  footerRest: ' / SAN FRANCISCO', // bottom line, rest (muted)
  background: '#181B1C',
  ink: '#EEF0EA',
  muted: '#8D938F',
  accent: '#C9EF8A',
};

const { Text, Mark } = kit;
const { useCurrentFrame, Easing } = R;
const FPS = kit.fps;
const W = kit.width;
const H = kit.height;
const MARGIN = 96; // the remake's 72 plus room for the 24 px overshoot inside the safe area
const ROW_H = 160;
const SIZE = 160;
const WEIGHT = 760;
const TRACKING = -0.045;
const ROWS_TOP = Math.round((H - ROW_H * 3) / 2);
const words = (value) => {
  const list = String(value).split('|').map((word) => word.trim()).filter(Boolean);
  while (list.length < 3) list.push('');
  return list.slice(0, 3);
};
const SET_A = words(SLOTS.first);
const SET_B = words(SLOTS.second);

// Timing in seconds (the remake's numbers).
const ENTER_DIST = 1400;
const ENTER_OVERSHOOT = 24;
const ENTER_STAGGER = 0.09;
const ENTER_DUR = 0.8 - ENTER_STAGGER * 2; // the last word rests at 0.8 s
const enterCurve = Easing.bezier(0.18, 0.9, 0.24, 1.13);
const SWAP_START = 1.85;
const SWAP_END = 2.35;
const SWAP_STAGGER = 0.07;
const SWAP_DUR = SWAP_END - SWAP_START - SWAP_STAGGER * 2;
const SWAP_DIST = 1220;
const swapCurve = Easing.bezier(0.45, 0, 0.15, 1);
const swapEase = (u) => kit.snap(u, { overshoot: 14 / SWAP_DIST, split: 0.8, curve: swapCurve });

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const swapU = (row, t) => clamp01((t - SWAP_START - row * SWAP_STAGGER) / SWAP_DUR + 1e-9);
const offA = (row, t) => (t < SWAP_START + row * SWAP_STAGGER ? kit.travel((t - row * ENTER_STAGGER) / ENTER_DUR, ENTER_DIST, { curve: enterCurve, overshoot: ENTER_OVERSHOOT }) : -SWAP_DIST * swapEase(swapU(row, t)));
const offB = (row, t) => SWAP_DIST * (1 - swapEase(swapU(row, t)));
const widthOf = (text) => kit.measure(text, { size: SIZE, font: 'Inter', weight: WEIGHT, tracking: TRACKING });
// The remake measures speed per 1/60 s; keeping that unit keeps its smear at our 30 fps.
const STEP = 1 / 60;

// Seam feather: the outgoing word fades out just left of the seam, the incoming one fades in just right of it.
const GAP = 3;
const FEATHER = 26;
const outMask = (seam) => `linear-gradient(90deg, #000 0px, #000 ${(seam - GAP - FEATHER).toFixed(2)}px, transparent ${(seam - GAP).toFixed(2)}px)`;
const inMask = (seam) => `linear-gradient(90deg, transparent 0px, transparent ${(seam + GAP).toFixed(2)}px, #000 ${(seam + GAP + FEATHER).toFixed(2)}px)`;

function Word({ text, accent, offset, smear, id, mask, name }) {
  const rest = Math.abs(offset) < 0.01 && smear.blur === 0 && smear.stretch === 1;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: ROW_H, WebkitMaskImage: mask, maskImage: mask }}>
      <Text
        text={text}
        x={MARGIN}
        y={(ROW_H - SIZE * 1.0) / 2}
        size={SIZE}
        font="Inter"
        weight={WEIGHT}
        tracking={TRACKING}
        lineHeight={1}
        color={accent ? SLOTS.accent : SLOTS.ink}
        name={name}
        style={{ whiteSpace: 'nowrap', transform: rest ? 'none' : `translateX(${offset.toFixed(3)}px) scaleX(${smear.stretch.toFixed(4)})`, transformOrigin: '0% 50%', filter: smear.blur > 0 ? `url(#${id})` : 'none' }}
      />
    </div>
  );
}

return function Scene() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const blurs = {};
  const rows = [0, 1, 2].map((row) => {
    const aW = widthOf(SET_A[row]);
    const bW = widthOf(SET_B[row]);
    const a = offA(row, t);
    const b = offB(row, t);
    const aRest = t < SWAP_START + row * SWAP_STAGGER && t - row * ENTER_STAGGER >= ENTER_DUR - 1e-9;
    const settled = swapU(row, t) >= 1;
    const aSmear = aRest ? { blur: 0, stretch: 1 } : kit.smear(a - offA(row, t - STEP), aW);
    // The last 20% of the swap is a 14 px settle: too slow to smear, and a smear there reads as soft text at rest.
    const bSmear = settled || swapU(row, t) > 0.8 ? { blur: 0, stretch: 1 } : kit.smear(b - offB(row, t - STEP), bW);
    if (aSmear.blur > 0) blurs[`snap-a${row}`] = aSmear.blur;
    if (bSmear.blur > 0) blurs[`snap-b${row}`] = bSmear.blur;
    const swapping = t >= SWAP_START + row * SWAP_STAGGER;
    const outRight = MARGIN + a + aW * aSmear.stretch;
    const seam = (outRight + MARGIN + b) / 2;
    const showA = !settled && outRight + aSmear.blur * 3 > 0;
    return { row, a, b, aSmear, bSmear, swapping, settled, seam, showA };
  });
  const rule = 'rgba(238, 240, 234, 0.055)';
  const strong = 'rgba(238, 240, 234, 0.14)';
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: SLOTS.background }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 85% 75% at 40% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.28) 100%)' }} />
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          {Object.entries(blurs).map(([id, sigma]) => (
            <filter key={id} id={id} x="-60%" y="-10%" width="220%" height="120%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={`${sigma.toFixed(2)} 0`} />
            </filter>
          ))}
        </defs>
      </svg>
      <Mark name="dot" x={MARGIN} y={ROWS_TOP - 330} w={14} h={14}>
        <div style={{ width: 14, height: 14, borderRadius: 7, background: SLOTS.accent }} />
      </Mark>
      <Text text={SLOTS.label} x={MARGIN + 30} y={ROWS_TOP - 341} size={36} font="Inter" weight={700} tracking={0.18} color={SLOTS.ink} name="Label" />
      <div style={{ position: 'absolute', left: MARGIN, top: ROWS_TOP - 260, width: W - MARGIN * 2, height: 1, background: strong }} />
      <div style={{ position: 'absolute', left: MARGIN, top: ROWS_TOP + ROW_H * 3 + 260, width: W - MARGIN * 2, height: 1, background: strong }} />
      <Text text={SLOTS.footer} x={MARGIN} y={ROWS_TOP + ROW_H * 3 + 300} size={36} font="Inter" weight={560} tracking={0.12} color={SLOTS.ink} name="Footer" style={{ whiteSpace: 'pre' }} />
      <Text text={SLOTS.footerRest} x={MARGIN + kit.measure(SLOTS.footer, { size: 36, font: 'Inter', weight: 560, tracking: 0.12 }) + 0.12 * 36} y={ROWS_TOP + ROW_H * 3 + 300} size={36} font="Inter" weight={560} tracking={0.12} color={SLOTS.muted} name="Footer rest" style={{ whiteSpace: 'pre' }} />
      {[0, 1, 2, 3].map((k) => (
        <div key={k} style={{ position: 'absolute', left: 0, top: ROWS_TOP + k * ROW_H, width: W, height: 1, background: rule }} />
      ))}
      <div style={{ position: 'absolute', left: 0, top: ROWS_TOP, width: W, height: ROW_H * 3, overflow: 'hidden' }}>
        {rows.map(({ row, a, b, aSmear, bSmear, swapping, settled, seam, showA }) => (
          <div key={row} style={{ position: 'absolute', left: 0, top: row * ROW_H, width: W, height: ROW_H, overflow: 'hidden' }}>
            {showA ? <Word text={SET_A[row]} accent={row === 2} offset={a} smear={aSmear} id={`snap-a${row}`} mask={swapping ? outMask(seam) : undefined} name={`First ${row + 1}`} /> : null}
            {swapping ? <Word text={SET_B[row]} accent={row === 2} offset={b} smear={bSmear} id={`snap-b${row}`} mask={settled || !showA ? undefined : inMask(seam)} name={`Second ${row + 1}`} /> : null}
          </div>
        ))}
      </div>
    </>
  );
};
