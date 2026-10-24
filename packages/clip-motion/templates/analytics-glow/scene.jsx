// Analytics card: soft capsules grow from dots with a spring, the total counts up with them, then one column
// warms with a glow and the result lands (chip, delta badge, one quiet sentence). Ported from
// opus-pro/opusclip-video-tools remakes/opus-5.5/template-analytics-glow (MIT, Copyright (c) 2026 OpusClip):
// same timings (kept in 60 fps units, so seconds are unchanged at our 30 fps), springs, shadows and motion blur;
// the data and words are slots, and the 960x540 card is scaled up to fill a 1080 p frame.
const SLOTS = {
  title: 'Weekly signups',
  period: 'Last 7 days',
  labels: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', // 7 short labels
  values: '210,264,238,286,361,230,220', // 7 numbers, same order
  highlight: '5', // which column glows, 1-7
  delta: '12.4%',
  accent: '#FF7A3D',
};

const { useCurrentFrame } = R;
const FPS = kit.fps;
const W = kit.width;
const H = kit.height;
const SCALE = 2.3 * (H / 1080);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const progress = (f, start, end) => clamp01((f - start) / (end - start));
const lerp = (a, b, t) => a + (b - a) * t;
const bezier = R.Easing.bezier;
const easeOut = bezier(0.22, 1, 0.36, 1);
const easeInOut = bezier(0.65, 0, 0.35, 1);
const easeOutSoft = bezier(0.16, 1, 0.3, 1);
const ease = (f, start, end, fn = easeOut) => fn(progress(f, start, end));
// Under-damped spring step response; t in seconds.
const spring = (t, zeta = 0.74, omega = 8.4) => {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
};
const rgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t, alpha = 1) => {
  const ca = rgb(a);
  const cb = rgb(b);
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], clamp01(t))));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
};
const hexOf = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const WARM = SLOTS.accent;
const WARM_LIGHT = hexOf(rgb(WARM).map((v) => v + (255 - v) * 0.45));
const WARM_MID = hexOf(rgb(WARM).map((v) => v + (255 - v) * 0.2));
const WARM_DEEP = hexOf(rgb(WARM).map((v) => v * 0.81));
const [WR, WG, WB] = rgb(WARM);
const glow = (a) => `rgba(${WR},${WG},${WB},${a})`;
const INK = '#15171C';
const MUTED = '#868C96';
const FAINT = '#A3A8B0';
const FONT = kit.font.text;

// Card layout, card-local px at 960x540.
const CARD_W = 394;
const CARD_H = 326;
const PAD = 28;
const CHART_TOP = 104;
const WELL_W = 32;
const WELL_H = 132;
const WELL_GAP = 19;
const BAR_INSET = 4;
const BAR_W = WELL_W - BAR_INSET * 2;
const BAR_MAX = WELL_H - BAR_INSET * 2;
const LABEL_TOP = CHART_TOP + WELL_H + 10;
const DIVIDER_TOP = 274;
const FOOTER_TOP = 287;

const labels = SLOTS.labels.split(',').map((label) => label.trim()).slice(0, 7);
const numbers = SLOTS.values.split(',').map((value) => Number(value.trim()) || 0).slice(0, 7);
const peak = Math.max(1, ...numbers);
// The tallest column fills 62% of its well, as in the remake.
const DAYS = labels.map((label, i) => ({ label, value: (0.62 * (numbers[i] ?? 0)) / peak, sessions: numbers[i] ?? 0 }));
const HERO = Math.min(DAYS.length - 1, Math.max(0, Math.round(Number(SLOTS.highlight)) - 1));
const average = numbers.reduce((sum, v) => sum + v, 0) / Math.max(1, numbers.length);
const ABOVE = Math.round(((numbers[HERO] ?? 0) / Math.max(1, average) - 1) * 100);

// Timeline, frames at 60 fps (3.00 s).
const T = { cardIn: [0, 34], label: [6, 28], value: [12, 34], wellsIn: 6, dotsIn: 12, growStart: 24, growStagger: 5, highlight: [90, 126], chip: [106, 132], delta: [112, 138], footer: [118, 146] };
const F60 = 60;

const colX = (i) => PAD + i * (WELL_W + WELL_GAP);
const barTarget = (i) => Math.round(Math.max(BAR_W, DAYS[i].value * BAR_MAX));
const barHeight = (i, f) => lerp(BAR_W, barTarget(i), spring((f - (T.growStart + i * T.growStagger)) / F60, 0.76, 8.2));
const highlightAt = (f) => ease(f, T.highlight[0], T.highlight[1], easeInOut);
// The glow rises a little past 1 and relaxes, so the emphasis lands.
const bloomAt = (f) => ease(f, T.highlight[0] + 4, T.highlight[1] + 4, easeInOut) * (1 + 0.16 * Math.sin(Math.PI * easeOutSoft(progress(f, T.highlight[0] + 14, T.highlight[1] + 34))));
const sheenAt = (f) => progress(f, T.highlight[0] + 6, T.highlight[1] + 6);
// A 180-degree shutter at our frame rate, in 60 fps units.
const SHUTTER = (0.5 * F60) / FPS;

function Bar({ i, f, hl, dim }) {
  const sheen = sheenAt(f);
  const hA = barHeight(i, f - SHUTTER);
  const hB = barHeight(i, f + SHUTTER);
  const hMid = barHeight(i, f);
  const lo = Math.min(hA, hB);
  const hi = Math.max(hA, hB);
  const blurred = hi - lo > 0.75;
  const fillH = blurred ? hi : hMid;
  // Motion blur: feather the region the leading edge swept during the shutter.
  const mask = blurred ? `linear-gradient(to top, #000 0px, #000 ${lo.toFixed(2)}px, rgba(0,0,0,0) ${hi.toFixed(2)}px)` : undefined;
  const dotP = ease(f, T.dotsIn + i * 3, T.dotsIn + i * 3 + 18);
  const isHero = i === HERO;
  const warm = isHero ? hl : 0;
  const neutral = lerp(1, 0.55, dim);
  const shadow = isHero
    ? [`0 0 0 0.5px ${mix('#141821', WARM_DEEP, warm, lerp(0.07, 0.16, warm))}`, `0 1px 1.5px ${mix('#141821', WARM_DEEP, warm, lerp(0.1, 0.2, warm))}`, `0 4px 10px -2px ${mix('#141821', WARM, warm, lerp(0.1, 0.38, warm))}`].join(', ')
    : [`0 0 0 0.5px rgba(20,24,33,${0.07 * neutral})`, `0 1px 1.5px rgba(20,24,33,${0.1 * neutral})`, `0 4px 10px -2px rgba(20,24,33,${0.1 * neutral})`].join(', ');
  return (
    <div style={{ position: 'absolute', left: colX(i) + BAR_INSET, top: CHART_TOP + WELL_H - BAR_INSET, width: BAR_W, height: 0, opacity: dotP, transform: dotP < 1 ? `scale(${lerp(0.55, 1, dotP)})` : undefined, transformOrigin: `${BAR_W / 2}px ${-BAR_W / 2}px` }}>
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: BAR_W, height: (lo + hi) / 2, borderRadius: BAR_W / 2, boxShadow: shadow }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: BAR_W, height: fillH, borderRadius: BAR_W / 2, overflow: 'hidden', WebkitMaskImage: mask, maskImage: mask, background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFAFB 60%, #F3F4F6 100%)' }}>
        {isHero && warm > 0 ? <div style={{ position: 'absolute', inset: 0, opacity: warm, background: `linear-gradient(180deg, ${WARM_LIGHT} 0%, ${WARM_MID} 42%, ${WARM} 100%)` }} /> : null}
        {isHero && sheen > 0 && sheen < 1 ? (
          <div style={{ position: 'absolute', left: 0, right: 0, height: 46, bottom: lerp(-46, fillH + 10, bezier(0.45, 0, 0.25, 1)(sheen)), opacity: Math.sin(Math.PI * sheen) * 0.55, background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 100%)' }} />
        ) : null}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BAR_W, borderRadius: BAR_W / 2, background: `radial-gradient(ellipse 70% 60% at 50% 18%, rgba(255,255,255,${isHero ? lerp(0.9, 0.38, warm) : 0.9}) 0%, rgba(255,255,255,0) 70%)` }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: BAR_W / 2, boxShadow: `inset 0 1px 0 rgba(255,255,255,${isHero ? lerp(1, 0.55, warm) : 1}), inset 0 -1px 0 ${isHero ? mix('#141821', WARM_DEEP, warm, lerp(0.03, 0.18, warm)) : 'rgba(20,24,33,0.03)'}` }} />
      </div>
    </div>
  );
}

return function Scene() {
  const f = (useCurrentFrame() * F60) / FPS;
  const cardP = ease(f, T.cardIn[0], T.cardIn[1]);
  const cardY = lerp(22, 0, cardP);
  const cardS = lerp(0.955, 1, cardP);
  const cardO = clamp01(ease(f, 0, 20));
  const labelP = ease(f, T.label[0], T.label[1]);
  const valueP = ease(f, T.value[0], T.value[1]);
  // The total is the running sum of each column's own growth, so number and bars move as one.
  const shown = Math.round(DAYS.reduce((acc, d, i) => {
    const s0 = T.growStart + i * T.growStagger;
    return acc + d.sessions * ease(f, s0 - 8, s0 + 40, (x) => 1 - Math.pow(1 - x, 2.4));
  }, 0));
  const hl = highlightAt(f);
  const bloom = bloomAt(f);
  const chipP = ease(f, T.chip[0], T.chip[1]);
  const deltaP = ease(f, T.delta[0], T.delta[1]);
  const footerP = ease(f, T.footer[0], T.footer[1]);
  const heroH = barHeight(HERO, f);
  const heroCx = colX(HERO) + BAR_INSET + BAR_W / 2;
  const heroBottom = CHART_TOP + WELL_H - BAR_INSET;
  const heroTop = heroBottom - heroH;
  const chipTop = heroBottom - barTarget(HERO) - 8 - 24;
  const rest = (p) => p >= 1; // resting elements get no transform, so text stays crisp
  return (
    <R.AbsoluteFill style={{ background: 'radial-gradient(ellipse 80% 75% at 50% 42%, #FBFBFA 0%, #F3F3F1 48%, #E9E9E6 100%)', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ position: 'absolute', left: (W - 960 * SCALE) / 2, top: (H - 540 * SCALE) / 2, width: 960, height: 540, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}>
        <div style={{ position: 'absolute', left: 480 - 170, top: 270 + CARD_H / 2 - 18, width: 340, height: 40, borderRadius: '50%', background: 'rgba(40,44,52,0.11)', filter: 'blur(22px)', opacity: cardO * lerp(0.2, 1, cardP), transform: `translateY(${cardY * 0.4}px) scaleX(${lerp(0.8, 1, cardP)})` }} />
        <div
          data-box="mark"
          data-name="Analytics card"
          style={{
            position: 'absolute', left: (960 - CARD_W) / 2, top: (540 - CARD_H) / 2, width: CARD_W, height: CARD_H, opacity: cardO,
            transform: rest(cardP) ? undefined : `translateY(${cardY}px) scale(${cardS})`, transformOrigin: '50% 60%', borderRadius: 26,
            background: 'linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 55%, #FCFCFB 100%)',
            boxShadow: ['0 0 0 1px rgba(20,24,33,0.05)', '0 1px 2px rgba(20,24,33,0.04)', `0 10px 22px -8px rgba(20,24,33,${lerp(0.04, 0.09, cardP)})`, `0 30px 60px -22px rgba(20,24,33,${lerp(0.05, 0.13, cardP)})`, 'inset 0 1px 0 #FFFFFF'].join(', '),
          }}
        >
          <div style={{ position: 'absolute', inset: 0, borderRadius: 26, overflow: 'hidden', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: heroCx - 150, top: heroTop - 70, width: 300, height: heroH + 170, borderRadius: '50%', background: `radial-gradient(closest-side, ${glow(0.16)}, ${glow(0)})`, opacity: bloom }} />
          </div>
          <div style={{ position: 'absolute', left: PAD, top: 24, height: 18, display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 500, letterSpacing: '0.005em', color: MUTED, opacity: labelP, transform: rest(labelP) ? undefined : `translateY(${lerp(6, 0, labelP)}px)` }}>
            <span>{SLOTS.title}</span>
            <span style={{ width: 3, height: 3, borderRadius: 2, background: '#C9CCD1' }} />
            <span style={{ color: FAINT }}>{SLOTS.period}</span>
          </div>
          <div style={{ position: 'absolute', right: PAD, top: 22, height: 22, padding: '0 8px', borderRadius: 11, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.01em', fontVariantNumeric: 'tabular-nums', color: WARM_DEEP, background: mix('#FFFFFF', WARM, 0.09), boxShadow: `inset 0 0 0 1px ${glow(0.16)}`, opacity: deltaP, transform: rest(deltaP) ? undefined : `translateX(${lerp(8, 0, deltaP)}px)` }}>
            <svg width="8" height="8" viewBox="0 0 8 8" style={{ display: 'block' }}><path d="M4 1.2 L7 5.6 H1 Z" fill={WARM_DEEP} /></svg>
            <span>{SLOTS.delta}</span>
          </div>
          <div data-box="text" data-name="Total" data-size={36 * SCALE} style={{ position: 'absolute', left: PAD - 1, top: 47, fontSize: 36, lineHeight: '40px', fontWeight: 650, letterSpacing: '-0.025em', color: INK, fontVariantNumeric: 'tabular-nums', opacity: valueP, transform: rest(valueP) ? undefined : `translateY(${lerp(8, 0, valueP)}px)` }}>
            {shown.toLocaleString('en-US')}
          </div>
          {DAYS.map((d, i) => {
            const p = ease(f, T.wellsIn + i * 2, T.wellsIn + i * 2 + 22);
            const warmWell = i === HERO ? hl : 0;
            return (
              <div key={`well-${i}`} style={{ position: 'absolute', left: colX(i), top: CHART_TOP, width: WELL_W, height: WELL_H, borderRadius: WELL_W / 2, opacity: p, background: `linear-gradient(180deg, ${mix('#F1F2F4', hexOf(rgb(WARM).map((v) => v + (255 - v) * 0.88)), warmWell)} 0%, ${mix('#F6F6F8', hexOf(rgb(WARM).map((v) => v + (255 - v) * 0.92)), warmWell)} 100%)`, boxShadow: [`inset 0 1px 2px rgba(20,24,33,${lerp(0.06, 0.04, warmWell)})`, `inset 0 0 0 1px ${mix('#141821', WARM, warmWell, lerp(0.028, 0.08, warmWell))}`, '0 1px 0 rgba(255,255,255,0.9)'].join(', ') }} />
            );
          })}
          <div data-box="mark" data-name="Highlight glow" style={{ position: 'absolute', left: heroCx - (BAR_W + 44) / 2, top: heroTop - 16, width: BAR_W + 44, height: heroH + 30, borderRadius: 40, background: glow(0.5), filter: 'blur(18px)', opacity: bloom * 0.85, transform: `scale(${lerp(0.7, 1, clamp01(bloom))})` }} />
          <div style={{ position: 'absolute', left: heroCx - (BAR_W + 10) / 2, top: heroTop - 4, width: BAR_W + 10, height: heroH + 6, borderRadius: (BAR_W + 10) / 2, background: glow(0.55), filter: 'blur(7px)', opacity: bloom }} />
          {DAYS.map((d, i) => <Bar key={`bar-${i}`} i={i} f={f} hl={hl} dim={i === HERO ? 0 : hl} />)}
          {DAYS.map((d, i) => {
            const p = ease(f, T.wellsIn + 6 + i * 2, T.wellsIn + 28 + i * 2);
            return (
              <div key={`label-${i}`} style={{ position: 'absolute', left: colX(i) - 8, top: LABEL_TOP, width: WELL_W + 16, textAlign: 'center', fontSize: 11, lineHeight: '14px', fontWeight: 600, letterSpacing: '0.02em', color: i === HERO ? mix('#A3A8B0', WARM_DEEP, hl) : FAINT, opacity: p }}>
                {d.label}
              </div>
            );
          })}
          <div style={{ position: 'absolute', left: heroCx - 32, top: chipTop, width: 64, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: '#FFFFFF', boxShadow: ['0 0 0 1px rgba(20,24,33,0.06)', '0 1px 2px rgba(20,24,33,0.06)', '0 6px 14px -4px rgba(20,24,33,0.14)'].join(', '), fontSize: 12, fontWeight: 650, letterSpacing: '0.005em', color: INK, fontVariantNumeric: 'tabular-nums', opacity: chipP, transform: rest(chipP) ? undefined : `translateY(${lerp(8, 0, chipP)}px) scale(${lerp(0.9, 1, chipP)})`, transformOrigin: '50% 100%' }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: `linear-gradient(180deg, ${WARM_LIGHT}, ${WARM})`, boxShadow: `0 0 6px ${glow(0.6)}` }} />
            <span>{(numbers[HERO] ?? 0).toLocaleString('en-US')}</span>
          </div>
          <div style={{ position: 'absolute', left: PAD, right: PAD, top: DIVIDER_TOP, height: 1, background: 'rgba(20,24,33,0.06)', transformOrigin: '0 50%', transform: `scaleX(${ease(f, 40, 90)})` }} />
          <div style={{ position: 'absolute', left: PAD, top: FOOTER_TOP, height: 16, display: 'flex', alignItems: 'center', fontSize: 12.5, lineHeight: '16px', fontWeight: 500, color: MUTED, opacity: footerP, transform: rest(footerP) ? undefined : `translateY(${lerp(6, 0, footerP)}px)` }}>
            <span>
              {DAYS[HERO]?.label} peaked <span style={{ color: INK, fontWeight: 600 }}>{Math.abs(ABOVE)}% {ABOVE >= 0 ? 'above' : 'below'}</span> your daily average
            </span>
          </div>
        </div>
      </div>
    </R.AbsoluteFill>
  );
};
