// Neon tech: data drawn as light. A waveform draws on, its pauses light up magenta, then collapse so the speech closes up.
const { Text, Mark, fx } = kit;
const { useCurrentFrame } = R;

const BG = '#04060C';
const CYAN = '#3BE8FF';
const MAGENTA = '#FF3D7F';
const INK = '#E8F1FF';
const DIM = '#5A6B8C';

const W = kit.width;
const H = kit.height;
const M = Math.round(W * 0.08);
const WAVE = { x: M, y: Math.round(H * 0.47), w: W - 2 * M, amp: Math.round(H * 0.085) };
const b = kit.beat;

// The take, in seconds: speech runs and the pauses between them.
const T = 10;
const PAUSES = [[2.2, 3.1], [5.0, 6.1], [7.5, 8.6]];
const SAVED = PAUSES.reduce((sum, [a, z]) => sum + (z - a), 0);
const px = (t) => (t / T) * WAVE.w;
const env = kit.noise(7);
const level = (t) => (PAUSES.some(([a, z]) => t > a && t < z) ? 0.025 : 0.25 + 0.75 * Math.abs(env(t * 2.3)) * (0.6 + 0.4 * Math.abs(env(t * 9.1 + 3))));
const BARS = Array.from({ length: 150 }, (_, i) => {
  const t = (i + 0.5) * (T / 150);
  return { t, h: Math.max(3, level(t) * WAVE.amp) };
});
// How far a bar at time t slides left when the pauses before it close.
const before = (t) => PAUSES.reduce((sum, [a, z]) => sum + (t >= z ? z - a : 0), 0);

function Grid() {
  const f = useCurrentFrame();
  const rows = 9;
  const drift = (f * 0.6) % (H * 0.04);
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id="fadeUp" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={CYAN} stopOpacity="0.22" />
          <stop offset="1" stopColor={CYAN} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: 13 }, (_, i) => {
        const x = (i / 12) * W;
        return <line key={`v${i}`} x1={W / 2 + (x - W / 2) * 0.18} y1={H * 0.62} x2={W / 2 + (x - W / 2) * 2.2} y2={H} stroke="url(#fadeUp)" strokeWidth={1.5} />;
      })}
      {Array.from({ length: rows }, (_, i) => {
        const k = (i + drift / (H * 0.04)) / rows;
        const y = H * 0.62 + (H * 0.38) * k * k;
        return <line key={`h${i}`} x1={0} y1={y} x2={W} y2={y} stroke={CYAN} strokeOpacity={0.05 + 0.13 * k} strokeWidth={1.5} />;
      })}
    </svg>
  );
}

return function Scene() {
  const f = useCurrentFrame();
  const draw = kit.tween(f, [b(0).from + 4, b(0).from + 40], [0, 1], 'smooth');
  const scan = kit.tween(f, [b(1).from, b(1).from + 30], [0, 1], 'smooth');
  const close = kit.tween(f, [b(2).from + 2, b(2).from + 26], [0, 1], 'snap');
  const saved = kit.tween(f, [b(2).from + 6, b(2).from + 32], [0, SAVED], 'out');
  const glow = 0.85 + 0.15 * Math.sin(f / 9);
  const shift = (t) => px(before(t)) * close;
  const tight = WAVE.w - px(SAVED) * close;
  const offset = (WAVE.w - tight) / 2; // keep the closing waveform centred
  return (
    <>
      <fx.Fill color={BG} />
      <Grid />
      <fx.Vignette strength={0.55} />
      <Text text="REMOVE SILENCE" x={M} y={H * 0.12} size={38} font="Source Code Pro" weight={600} tracking={0.2} color={CYAN} style={{ textShadow: `0 0 18px ${CYAN}` }} />
      <Text text="Every pause, gone." x={M} y={H * 0.155} w={W - 2 * M} size={Math.round(W * 0.11)} font="Space Grotesk" weight={700} tracking={-0.03} lineHeight={1.04} color={INK} />
      <Mark name="waveform" x={WAVE.x} y={WAVE.y - WAVE.amp} w={WAVE.w} h={WAVE.amp * 2} at={b(0).from}>
        <svg width={WAVE.w} height={WAVE.amp * 2} style={{ overflow: 'visible', filter: `drop-shadow(0 0 6px ${CYAN}) drop-shadow(0 0 22px rgba(59, 232, 255, ${0.45 * glow}))` }}>
          {BARS.map((bar, i) => {
            const x = px(bar.t) - shift(bar.t) + offset * close;
            const shown = bar.t / T <= draw;
            const inPause = PAUSES.find(([a, z]) => bar.t > a && bar.t < z);
            if (!shown || (inPause && close >= 1)) return null;
            const fadeOut = inPause ? 1 - close : 1;
            return <line key={i} x1={x} x2={x} y1={WAVE.amp - bar.h} y2={WAVE.amp + bar.h} stroke={inPause && scan * T > bar.t ? MAGENTA : CYAN} strokeWidth={3.2} strokeLinecap="round" opacity={fadeOut} />;
          })}
        </svg>
      </Mark>
      {PAUSES.map(([a, z], i) => {
        const lit = scan * T > a;
        const x0 = WAVE.x + px(a) - shift(a) + offset * close;
        const width = px(z - a) * (1 - close);
        if (!lit || width < 2) return null;
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: x0, top: WAVE.y - WAVE.amp * 1.15, width, height: WAVE.amp * 2.3, background: `linear-gradient(180deg, transparent, rgba(255, 61, 127, 0.22), transparent)`, borderLeft: `2px solid ${MAGENTA}`, borderRight: `2px solid ${MAGENTA}`, boxShadow: `0 0 24px rgba(255, 61, 127, 0.5)` }} />
            <Text name={`pause ${i + 1}`} text={`${(z - a).toFixed(1)}s`} x={x0 + width / 2} y={WAVE.y - WAVE.amp * 1.15 - 54} size={38} font="Source Code Pro" weight={600} color={MAGENTA} align="center" style={{ opacity: 1 - close }} />
          </React.Fragment>
        );
      })}
      {scan > 0 && scan < 1 ? <div style={{ position: 'absolute', left: WAVE.x + scan * WAVE.w, top: WAVE.y - WAVE.amp * 1.4, width: 2, height: WAVE.amp * 2.8, background: INK, boxShadow: `0 0 16px ${CYAN}, 0 0 40px ${CYAN}` }} /> : null}
      <Text name="saved" text={`−${saved.toFixed(1)} s`} x={W / 2} y={H * 0.6} size={Math.round(W * 0.17)} font="Space Grotesk" weight={700} tracking={-0.03} color={CYAN} align="center" at={b(2).from + 4} style={{ textShadow: `0 0 30px rgba(59, 232, 255, 0.6)` }} />
      <Text text="of dead air in a 10 s take" x={W / 2} y={H * 0.6 + W * 0.19} size={40} font="Inter" weight={500} color={DIM} align="center" at={b(2).from + 14} />
      <fx.Grain opacity={0.05} />
    </>
  );
};
