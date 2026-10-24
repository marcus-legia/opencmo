// Brand reveal: a mark settles into an app tile, the tile rises, the name and tagline rise in with motion blur.
// Ported from opus-pro/opusclip-video-tools remakes/opus-5.5/pf-mark-lockup (MIT, Copyright (c) 2026 OpusClip):
// same curves, timings and blur; 60 fps seconds kept as seconds at our 30 fps; the product's copy and colours
// are slots, and the brand's own logo can replace the drawn mark.
const SLOTS = {
  logo: null, // an image name from kit.images (a square logo, ideally with transparency), or null for the drawn mark
  name: 'Lumen',
  tagline: 'Ideas, shipped every week.',
  background: '#151719',
  accent: '#FF6A55',
};

const { Image } = kit;
const { useCurrentFrame, Easing } = R;
const FPS = kit.fps;
const W = kit.width;
const H = kit.height;
const K = H / 1080; // the remake is drawn at 1080 p

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, p) => a + (b - a) * p;
const progress = (t, start, dur) => clamp01((t - start) / dur);
const hexMix = (a, b, p) => {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((x >> s) & 255) * (1 - p) + ((y >> s) & 255) * p);
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
};

const settle = Easing.bezier(0.24, 0.78, 0.2, 1);
const travel = Easing.bezier(0, 0, 0, 1);
const rise = Easing.bezier(0.16, 1, 0.3, 1);
const fade = Easing.bezier(0.33, 0, 0.2, 1);

const T = { introEnd: 0.5, petalStagger: 0.035, moveStart: 1.1, moveEnd: 1.8, wordStart: 1.24, letterStagger: 0.035, wordDur: 0.62, tagStart: 1.44, tagDur: 0.64 };
const TILE = 384;
const CX = W / 2;
const Y_START = H / 2;
const Y_END = H / 2 - 170 * K;
const SCALE_END = 0.52;

const tileState = (t) => {
  const a = settle(progress(t, 0, T.introEnd));
  const m = travel(progress(t, T.moveStart, T.moveEnd - T.moveStart));
  const petalDur = T.introEnd - 3 * T.petalStagger;
  return {
    cy: mix(Y_START, Y_END, m),
    scale: K * mix(0.64, 1, a) * mix(1, SCALE_END, m),
    rot: mix(-12, 0, a),
    blur: 10 * (1 - a) ** 1.7,
    petals: [0, 1, 2, 3].map((i) => settle(progress(t, i * T.petalStagger, petalDur))),
  };
};

// Rise from below with blur tied to speed over a half-frame shutter.
const riseState = (t, start, dur, distance, blurPerPx) => {
  const dyAt = (tt) => distance * (1 - rise(progress(tt, start, dur)));
  const dy = dyAt(t);
  const velocity = Math.abs(dyAt(t - 0.5 / FPS) - dy) / 0.5;
  return { dy, opacity: fade(progress(t, start, dur * 0.42)), blur: Math.min(18, velocity * blurPerPx) };
};

// The tile's own motion blur: how far its edges travel across the shutter.
const tileBlur = (t) => {
  const a = tileState(t);
  const b = tileState(Math.max(0, t - 0.5 / FPS));
  const half = (TILE / 2) * Math.abs(a.scale - b.scale);
  const rotPx = ((Math.abs(a.rot - b.rot) * Math.PI) / 180) * (TILE / 2) * a.scale;
  const mx = 0.34 * Math.hypot(half, rotPx);
  const my = 0.34 * (Math.abs(a.cy - b.cy) + half * 0.5) + 0.34 * rotPx * 0.5;
  return { x: Math.sqrt(a.blur * a.blur + mx * mx), y: Math.sqrt(a.blur * a.blur + my * my) };
};

// Continuous-corner tile: straight sides joined by quarter-superellipse corners.
const squircle = (() => {
  const corner = 0.305 * TILE;
  const pts = [];
  for (const [cx, cy, start] of [[TILE - corner, corner, -90], [TILE - corner, TILE - corner, 0], [corner, TILE - corner, 90], [corner, corner, 180]]) {
    for (let i = 0; i <= 90; i++) {
      const th = ((start + i) * Math.PI) / 180;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(`${(cx + corner * Math.sign(c) * Math.abs(c) ** (2 / 4.2)).toFixed(2)} ${(cy + corner * Math.sign(s) * Math.abs(s) ** (2 / 4.2)).toFixed(2)}`);
    }
  }
  return `M${pts.join('L')}Z`;
})();

const C = TILE / 2;
const PETAL_W = 80;
const PETAL_R0 = 27;
const PETAL_R1 = 150;

function Petal({ angle, p }) {
  const len = PETAL_R1 - PETAL_R0;
  const opacity = Math.min(1, p * 2.4);
  if (opacity <= 0) return null;
  return (
    <g transform={`rotate(${angle + mix(-20, 0, p)} ${C} ${C})`} opacity={opacity}>
      <g transform={`translate(${C + PETAL_R0 + len / 2 + mix(-22, 0, p)} ${C}) scale(${mix(0.35, 1, p)} ${mix(0.6, 1, p)})`}>
        <rect x={-len / 2} y={-PETAL_W / 2} width={len} height={PETAL_W} rx={PETAL_W / 2} fill="#FFFFFF" />
      </g>
    </g>
  );
}

function Tile({ t, blurred }) {
  const s = tileState(t);
  const accent = SLOTS.accent;
  return (
    <div data-box="mark" data-name="Logo tile" style={{ position: 'absolute', left: CX - C, top: s.cy - C, width: TILE, height: TILE, transform: `rotate(${s.rot}deg) scale(${s.scale})`, filter: blurred ? 'url(#tile-blur)' : undefined }}>
      <svg width={TILE} height={TILE} viewBox={`0 0 ${TILE} ${TILE}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <linearGradient id="tile-fill" x1="0" y1="0" x2="0" y2={TILE} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F9FBFD" />
            <stop offset="0.55" stopColor="#EEF2F6" />
            <stop offset="1" stopColor="#E1E7EE" />
          </linearGradient>
          <linearGradient id="tile-rim" x1="0" y1="0" x2="0" y2={TILE} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="0.35" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="0.75" stopColor="#8A97A6" stopOpacity="0" />
            <stop offset="1" stopColor="#8A97A6" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="tile-accent" x1="0" y1="54" x2="0" y2="330" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={hexMix(accent, '#FFFFFF', 0.16)} />
            <stop offset="0.5" stopColor={accent} />
            <stop offset="1" stopColor={hexMix(accent, '#000000', 0.08)} />
          </linearGradient>
          <mask id="tile-petals" maskUnits="userSpaceOnUse" x={0} y={0} width={TILE} height={TILE}>
            {[-45, 45, 135, 225].map((angle, i) => <Petal key={angle} angle={angle} p={s.petals[i]} />)}
          </mask>
          <clipPath id="tile-clip"><path d={squircle} /></clipPath>
          <filter id="tile-far" filterUnits="userSpaceOnUse" x={-300} y={-300} width={984} height={984}><feGaussianBlur stdDeviation={46} /></filter>
          <filter id="tile-near" filterUnits="userSpaceOnUse" x={-100} y={-100} width={584} height={584}><feGaussianBlur stdDeviation={9} /></filter>
          <filter id="tile-petal-shadow" filterUnits="userSpaceOnUse" x={0} y={0} width={TILE} height={TILE}>
            <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor={hexMix(accent, '#000000', 0.3)} floodOpacity="0.22" />
          </filter>
        </defs>
        <g transform="translate(0 34)" filter="url(#tile-far)"><path d={squircle} fill="#000" opacity={0.62} /></g>
        <g transform="translate(0 8)" filter="url(#tile-near)"><path d={squircle} fill="#000" opacity={0.42} /></g>
        <path d={squircle} fill="url(#tile-fill)" />
        <g clipPath="url(#tile-clip)"><path d={squircle} fill="none" stroke="url(#tile-rim)" strokeWidth={4} /></g>
        {SLOTS.logo ? null : (
          <g filter="url(#tile-petal-shadow)">
            <rect x={0} y={0} width={TILE} height={TILE} fill="url(#tile-accent)" mask="url(#tile-petals)" />
          </g>
        )}
      </svg>
      {SLOTS.logo ? (
        <div style={{ position: 'absolute', inset: 0, opacity: Math.min(1, s.petals[3] * 1.4), transform: `scale(${mix(0.8, 1, s.petals[0])})` }}>
          <Image name={SLOTS.logo} x={TILE * 0.19} y={TILE * 0.19} w={TILE * 0.62} h={TILE * 0.62} fit="contain" at={0} dur={1} />
        </div>
      ) : null}
    </div>
  );
}

// Resting lockup at 1080 p: tile bottom + 70 px to the name's cap line, name baseline + 40 px to the tagline.
const TILE_BOTTOM = Y_END + (TILE * SCALE_END * K) / 2;
const NAME_SIZE = 144 * K;
const TAG_SIZE = 40 * K; // the remake's 32 px is under our 36 px readable minimum at 1080 p
const NAME_TOP = TILE_BOTTOM + 70 * K - 0.18 * NAME_SIZE;
const TAG_TOP = NAME_TOP + NAME_SIZE * 0.98 + 40 * K - 0.1 * TAG_SIZE;

return function Scene() {
  const t = useCurrentFrame() / FPS;
  const blur = tileBlur(t);
  const letters = [...SLOTS.name];
  const word = letters.map((_, j) => riseState(t, T.wordStart + j * T.letterStagger, T.wordDur, 72 * K, 0.9));
  const tag = riseState(t, T.tagStart, T.tagDur, 40 * K, 0.8);
  return (
    <R.AbsoluteFill style={{ background: SLOTS.background, overflow: 'hidden' }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <filter id="tile-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={`${blur.x.toFixed(3)} ${blur.y.toFixed(3)}`} /></filter>
          {word.map((s, j) => (
            <filter key={j} id={`name-blur-${j}`} x="-10%" y="-120%" width="120%" height="340%"><feGaussianBlur stdDeviation={`0 ${s.blur.toFixed(3)}`} /></filter>
          ))}
          <filter id="tag-blur" x="-10%" y="-120%" width="120%" height="340%"><feGaussianBlur stdDeviation={`0 ${tag.blur.toFixed(3)}`} /></filter>
        </defs>
      </svg>
      {/* A filter, even at zero blur, clips the soft shadow to the filter region: only while it moves. */}
      <Tile t={t} blurred={blur.x > 0.03 || blur.y > 0.03} />
      <div style={{ position: 'absolute', left: 0, width: W, top: NAME_TOP, display: 'flex', justifyContent: 'center' }}>
        <div data-box="text" data-name={SLOTS.name} data-size={NAME_SIZE} style={{ display: 'flex', fontFamily: kit.font.display, fontSize: NAME_SIZE, fontWeight: 700, letterSpacing: '-0.012em', lineHeight: 1, color: '#F3F5F8' }}>
          {letters.map((ch, j) => (
            <span key={j} style={{ display: 'inline-block', whiteSpace: 'pre', transform: `translateY(${word[j].dy}px)`, opacity: word[j].opacity, filter: word[j].blur > 0.04 ? `url(#name-blur-${j})` : undefined }}>{ch}</span>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, width: W, top: TAG_TOP, display: 'flex', justifyContent: 'center' }}>
        <div data-box="text" data-name={SLOTS.tagline} data-size={TAG_SIZE} style={{ fontFamily: kit.font.display, fontSize: TAG_SIZE, fontWeight: 500, letterSpacing: '-0.004em', lineHeight: 1, color: '#99A2AD', whiteSpace: 'nowrap', transform: `translateY(${tag.dy}px)`, opacity: tag.opacity, filter: tag.blur > 0.04 ? 'url(#tag-blur)' : undefined }}>
          {SLOTS.tagline}
        </div>
      </div>
    </R.AbsoluteFill>
  );
};
