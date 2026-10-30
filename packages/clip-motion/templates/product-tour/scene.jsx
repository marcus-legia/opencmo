// Product tour: the opening lines stream in, a prompt box types the user's ask and a cursor presses the button,
// the box itself grows into the product's dashboard (one rectangle carried through the cut), the camera pushes in
// on the number that matters while it rolls up, then pulls back to the name and the call to action.
// Our own scene, written with the method of opus-pro/opusclip-video-tools templates/agent-opus (MIT, Copyright (c)
// 2026 OpusClip): one clock, staggered handoff phases, a shot-list camera with pose blur, a letter stream.
const SLOTS = {
  name: 'Lumen',
  opening: 'One idea.|A finished video.', // two short lines, split by |
  prompt: 'Turn my launch notes into a 30-second demo',
  button: 'Create',
  metricLabel: 'Shipped this week',
  metric: '128',
  cta: 'Try it free',
  screenshot: null, // an image name from kit.images (the user's own dashboard), or null for the drawn one
  background: '#F6F4EF',
  ink: '#16181D',
  accent: '#FF6A55',
};

const { Mark, Text, TypeStream, Camera, Image, fx } = kit;
const { useCurrentFrame } = R;
const W = kit.width;
const H = kit.height;
const K = H / 1080;
const CX = W / 2;
const CY = H / 2;
const lines = SLOTS.opening.split('|').map((line) => line.trim()).filter(Boolean).slice(0, 2);
const metric = Number(String(SLOTS.metric).replace(/[^0-9.]/g, '')) || 0;
const suffix = String(SLOTS.metric).replace(/[0-9.,\s]/g, '');

// Section starts (frames at 30 fps): open → prompt → handoff → focus → close.
const T = { open: 0, prompt: 72, type: 92, click: 150, handoff: 166, cards: 192, focus: 276, back: 348, close: 362, end: 420 };
const PROMPT = { x: CX - 600 * K, y: CY - 70 * K, w: 1200 * K, h: 140 * K };
const PANEL = { x: CX - 720 * K, y: 150 * K, w: 1440 * K, h: 760 * K };
const CARD_W = 420 * K;
const CARD_H = 230 * K;
const cardX = (i) => PANEL.x + 60 * K + i * (CARD_W + 30 * K);
const CARD_Y = PANEL.y + 130 * K;
const BUTTON = { x: PROMPT.x + PROMPT.w - 210 * K, y: PROMPT.y + 32 * K, w: 180 * K, h: 76 * K };
const focusCard = { x: cardX(0) + CARD_W / 2, y: CARD_Y + CARD_H / 2 };
const ZOOM = 1.7;

const shotsList = [
  { from: T.focus, to: T.focus + 22, pose: { scale: ZOOM, x: (CX - focusCard.x) * ZOOM, y: (CY - focusCard.y) * ZOOM } },
  { from: T.back, to: T.back + 18, pose: { scale: 1, x: 0, y: 0 }, curve: 'glide' },
];

const shadow = `0 ${30 * K}px ${60 * K}px rgba(22,24,29,0.12), 0 ${4 * K}px ${10 * K}px rgba(22,24,29,0.08)`;

function Opening({ frame }) {
  const leave = kit.tween(frame, [T.prompt - 10, T.prompt + 4], [0, 1], 'leave');
  if (leave >= 1) return null;
  return (
    // A slow push keeps the opening alive after the letters land.
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - leave, transform: `translateY(${-60 * K * leave}px) scale(${1 + 0.04 * Math.min(1, frame / T.prompt)})` }}>
      <TypeStream text={lines} x={CX} y={CY - 110 * K} size={110 * K} w={1500 * K} align="center" font="Plus Jakarta Sans" weight={700} color={SLOTS.ink} lineHeight={1.08} at={6} dur={40} name="Opening" />
    </div>
  );
}

function PromptContent({ frame, fade }) {
  const typed = Math.round(kit.tween(frame, [T.type, T.click - 12], [0, SLOTS.prompt.length], 'linear'));
  const caret = frame < T.click && Math.floor(frame / 8) % 2 === 0;
  const press = kit.tween(frame, [T.click, T.click + 4], [0, 1], 'snap') - kit.tween(frame, [T.click + 4, T.click + 12], [0, 1], 'out');
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - fade }}>
      <Text text={SLOTS.prompt.slice(0, Math.max(1, typed)) + (caret ? '|' : '')} x={40 * K} y={44 * K} size={40 * K} w={PROMPT.w - 300 * K} font="Inter" weight={500} color={SLOTS.ink} name="Prompt text" />
      <div style={{ position: 'absolute', left: BUTTON.x - PROMPT.x, top: BUTTON.y - PROMPT.y, width: BUTTON.w, height: BUTTON.h, borderRadius: 20 * K, background: SLOTS.accent, transform: `scale(${1 - 0.06 * press})`, boxShadow: `0 ${10 * K}px ${24 * K}px ${SLOTS.accent}55` }} />
      <Text text={SLOTS.button} x={BUTTON.x - PROMPT.x + BUTTON.w / 2} y={BUTTON.y - PROMPT.y + 18 * K} size={36 * K} align="center" font="Inter" weight={700} color="#FFFFFF" name="Button" />
    </div>
  );
}

function Dashboard({ frame, show }) {
  const rise = kit.phases(frame, { a: [T.cards, T.cards + 18, 'arrive'], b: [T.cards + 8, T.cards + 26, 'arrive'], c: [T.cards + 16, T.cards + 34, 'arrive'], line: [T.cards + 20, T.cards + 70, 'glide'], dim: [T.focus - 2, T.focus + 12, 'leave'], undim: [T.back, T.back + 12, 'arrive'] });
  // While the camera holds on the number, everything else steps back: one visual centre.
  const rest = 1 - rise.dim + rise.undim;
  const roll = kit.tween(frame, [T.focus + 4, T.focus + 46], [0, metric], 'arrive');
  const value = `${Math.round(roll).toLocaleString('en-US')}${suffix}`;
  if (SLOTS.screenshot) {
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: show }}>
        <Image name={SLOTS.screenshot} x={30 * K} y={30 * K} w={PANEL.w - 60 * K} h={PANEL.h - 60 * K} fit="cover" />
      </div>
    );
  }
  const points = [0.62, 0.55, 0.58, 0.44, 0.47, 0.33, 0.36, 0.2];
  const chart = { x: 60 * K, y: CARD_Y - PANEL.y + CARD_H + 40 * K, w: PANEL.w - 120 * K, h: 300 * K };
  const d = points.map((v, i) => `${i ? 'L' : 'M'} ${chart.x + (i / (points.length - 1)) * chart.w} ${chart.y + v * chart.h}`).join(' ');
  const card = (i, key, label, body) => (
    <div key={key} style={{ position: 'absolute', left: cardX(i) - PANEL.x, top: CARD_Y - PANEL.y + 40 * K * (1 - rise[key]), width: CARD_W, height: CARD_H, opacity: rise[key] * (i === 0 ? 1 : rest), borderRadius: 24 * K, background: i === 0 ? SLOTS.ink : '#FFFFFF', border: `${2 * K}px solid rgba(22,24,29,0.08)` }}>
      {body}
      <Text text={label} x={28 * K} y={CARD_H - 70 * K} size={36 * K} w={CARD_W - 56 * K} font="Inter" weight={500} color={i === 0 ? '#C9CCD3' : '#6B7080'} name={`Card ${key} label`} />
    </div>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: show }}>
      <div style={{ opacity: rest * kit.tween(frame, [T.handoff + 12, T.handoff + 24], [0, 1], 'arrive') }}><Text text={SLOTS.name} x={60 * K} y={46 * K} size={40 * K} font="Plus Jakarta Sans" weight={700} color={SLOTS.ink} name="Panel title" /></div>
      {card(0, 'a', SLOTS.metricLabel, <Text text={value} x={28 * K} y={26 * K} size={92 * K} font="Plus Jakarta Sans" weight={800} color="#FFFFFF" name="Metric" />)}
      {card(1, 'b', 'Drafts approved', <div style={{ position: 'absolute', left: 28 * K, top: 44 * K, width: (CARD_W - 56 * K) * 0.72 * rise.b, height: 18 * K, borderRadius: 9 * K, background: SLOTS.accent }} />)}
      {card(2, 'c', 'Avg. edit time', <Text text="4 min" x={28 * K} y={26 * K} size={72 * K} font="Plus Jakarta Sans" weight={800} color={SLOTS.ink} name="Edit time" />)}
      <svg style={{ position: 'absolute', left: 0, top: 0, opacity: rest }} width={PANEL.w} height={PANEL.h}>
        <path d={d} fill="none" stroke={SLOTS.accent} strokeWidth={6 * K} strokeLinecap="round" strokeLinejoin="round" {...kit.drawOn(rise.line)} />
      </svg>
    </div>
  );
}

function Cursor({ frame }) {
  const appear = kit.tween(frame, [T.click - 34, T.click - 26], [0, 1], 'out');
  const gone = kit.tween(frame, [T.handoff, T.handoff + 8], [0, 1], 'out');
  if (appear <= 0 || gone >= 1) return null;
  const [x, y] = kit.tween(frame, [T.click - 30, T.click - 2], [[CX + 420 * K, CY + 300 * K], [BUTTON.x + BUTTON.w * 0.55, BUTTON.y + BUTTON.h * 0.6]], 'glide');
  return (
    <Mark name="cursor" x={x} y={y} w={40 * K} h={52 * K} style={{ opacity: appear * (1 - gone) }}>
      <svg width={40 * K} height={52 * K} viewBox="0 0 20 26"><path d="M1 1 L1 21 L6 16 L10 25 L13 24 L9 15 L16 15 Z" fill={SLOTS.ink} stroke="#FFFFFF" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </Mark>
  );
}

function Product({ frame }) {
  if (frame < T.prompt - 2 || frame >= T.close + 12) return null;
  const arrive = kit.tween(frame, [T.prompt, T.prompt + 18], [0, 1], 'arrive');
  // The handoff: the prompt's rectangle grows into the dashboard panel; its old content leaves first, the new
  // one arrives after, so the eye follows one object through the cut.
  const hand = kit.handoff(frame, [T.handoff, T.handoff + 26], PROMPT, PANEL, 'expand');
  const step = kit.phases(frame, { old: [T.handoff - 2, T.handoff + 10, 'leave'], fresh: [T.handoff + 8, T.handoff + 24, 'arrive'], out: [T.back + 4, T.close + 10, 'leave'] });
  const box = hand;
  return (
    <Mark name="product" x={box.x} y={box.y} w={box.w} h={box.h} style={{ opacity: arrive * (1 - step.out), transform: `scale(${0.96 + 0.04 * arrive})` }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: (28 + 8 * hand.p) * K, background: '#FFFFFF', boxShadow: shadow, overflow: 'hidden' }}>
        {step.old < 1 ? <PromptContent frame={frame} fade={step.old} /> : null}
        {step.fresh > 0 ? <Dashboard frame={frame} show={step.fresh} /> : null}
      </div>
    </Mark>
  );
}

function Close({ frame }) {
  const p = kit.phases(frame, { name: [T.close, T.close + 22, 'arrive'], cta: [T.close + 10, T.close + 32, 'arrive'] });
  if (p.name <= 0) return null;
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, opacity: p.name, transform: `translateY(${40 * K * (1 - p.name)}px)` }}>
        <Text text={SLOTS.name} x={CX} y={CY - 150 * K} size={170 * K} align="center" font="Plus Jakarta Sans" weight={800} color={SLOTS.ink} tracking={-0.03} name="Name" />
      </div>
      <Mark name="cta" x={CX - 190 * K} y={CY + 70 * K} w={380 * K} h={96 * K} style={{ opacity: p.cta, transform: `translateY(${30 * K * (1 - p.cta)}px)` }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 48 * K, background: SLOTS.accent }} />
        <Text text={SLOTS.cta} x={190 * K} y={24 * K} size={42 * K} align="center" font="Inter" weight={700} color="#FFFFFF" name="CTA" />
      </Mark>
    </>
  );
}

// Promises the preview checks: the cursor and the call to action never leave the frame (the product may: the camera
// pushes in past its edges on purpose).
kit.audit.inside('cursor', 'full');
kit.audit.inside('cta', 'full');

return function Scene() {
  const frame = useCurrentFrame();
  return (
    <>
      <fx.Fill color={SLOTS.background} />
      <fx.GradientField colors={[SLOTS.background, kit.oklab(SLOTS.background, SLOTS.accent, 0.18), '#FFFFFF', kit.oklab(SLOTS.background, SLOTS.accent, 0.1)]} speed={0.4} />
      <Opening frame={frame} />
      <Camera shots={shotsList}>
        <Product frame={frame} />
        <Cursor frame={frame} />
      </Camera>
      <Close frame={frame} />
      <fx.Grain opacity={0.03} />
    </>
  );
};
