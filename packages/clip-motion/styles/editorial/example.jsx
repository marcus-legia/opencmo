// Editorial: a magazine spread in motion. Warm paper, serif display type rising out of masked lines, hairline grid,
// one vermilion accent, hard cuts between spreads.
const { Text, Mark, Shot, fx } = kit;
const { useCurrentFrame } = R;

const PAPER = '#EFE9DD';
const PAPER2 = '#E6DECF';
const INK = '#1A1A1A';
const MUTED = '#6F675C';
const RED = '#E4572E';
const W = kit.width;
const H = kit.height;
const M = Math.round(W * 0.08);
const COL = (W - 2 * M) / 6;
const b = kit.beat;

// A line of display type that rises out of its own baseline mask.
function Rise({ text, y, size, at, font = 'DM Serif Display', color = INK, name }) {
  const s = kit.useShot();
  const u = kit.tween(s.frame, [at, at + 16], [0, 1], 'out');
  const h = Math.round(size * 1.12);
  return (
    <div style={{ position: 'absolute', left: 0, top: y, width: W, height: h, overflow: 'hidden' }}>
      <Text name={name ?? text} text={text} x={M} y={0} size={size} font={font} weight={400} tracking={-0.02} lineHeight={1.08} color={color} style={{ transform: `translateY(${(1 - u) * h}px)` }} />
    </div>
  );
}

function Folio({ left, right }) {
  return (
    <>
      <Text text={left} x={M} y={H * 0.1} size={36} font="Inter" weight={600} tracking={0.16} upper color={INK} />
      <Text text={right} x={W - M} y={H * 0.1} size={36} font="Inter" weight={500} tracking={0.16} upper color={MUTED} align="right" />
    </>
  );
}

function Grid() {
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
      {Array.from({ length: 7 }, (_, i) => <line key={i} x1={M + i * COL} y1={H * 0.08} x2={M + i * COL} y2={H * 0.82} stroke={INK} strokeOpacity={0.06} strokeWidth={1.5} />)}
      <line x1={M} y1={H * 0.135} x2={W - M} y2={H * 0.135} stroke={INK} strokeWidth={2} />
    </svg>
  );
}

function SpreadOne() {
  const s = kit.useShot();
  const rule = kit.tween(s.frame, [2, 22], [0, 1], 'smooth');
  return (
    <>
      <Folio left="No. 01" right="The editor" />
      <svg width={W} height={20} style={{ position: 'absolute', left: 0, top: H * 0.3 }}>
        <line x1={M} y1={10} x2={W - M} y2={10} stroke={RED} strokeWidth={10} {...kit.drawOn(rule)} />
      </svg>
      <Rise text="One" y={H * 0.34} size={Math.round(W * 0.27)} at={8} />
      <Rise text="video." y={H * 0.34 + W * 0.29} size={Math.round(W * 0.27)} at={13} color={RED} />
    </>
  );
}

function SpreadTwo() {
  const s = kit.useShot();
  const f = s.frame;
  const caption = 'From the edit you already made.';
  const typed = Math.round(kit.tween(f, [b(2).from - b(1).from + 2, b(2).from - b(1).from + 30], [0, caption.length], 'linear'));
  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayW = (W - 2 * M - 6 * 16) / 7;
  return (
    <>
      <Folio left="No. 02" right="A week" />
      <Rise name="seven" text="7" y={H * 0.17} size={Math.round(W * 0.52)} at={0} />
      <Rise text="posts this week" y={H * 0.17 + W * 0.59} size={Math.round(W * 0.09)} at={6} color={RED} />
      <Mark name="week" x={M} y={H * 0.6} w={W - 2 * M} h={dayW * 1.4 + 60}>
        {DAYS.map((d, i) => {
          const u = kit.tween(f, [12 + i * 4, 24 + i * 4], [0, 1], 'out');
          return (
            <div key={i} style={{ position: 'absolute', left: i * (dayW + 16), top: 0, width: dayW, height: dayW * 1.4, border: `2.5px solid ${INK}` }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${u * 100}%`, background: RED }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: dayW * 1.4 + 12, textAlign: 'center', fontFamily: kit.font.Inter, fontWeight: 600, fontSize: 30, color: MUTED }}>{d}</div>
            </div>
          );
        })}
      </Mark>
      <Text name="caption" text={caption.slice(0, Math.max(1, typed))} x={M} y={H * 0.74} size={44} font="Fraunces" italic weight={400} color={INK} style={{ opacity: typed > 0 ? 1 : 0 }} />
    </>
  );
}

return function Scene() {
  const f = useCurrentFrame();
  const push = kit.tween(f, [0, kit.frames], [1, 1.035], 'linear');
  return (
    <>
      <fx.Fill color={PAPER} to={PAPER2} />
      <Grid />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: '50% 45%' }}>
        <Shot beat={0}><SpreadOne /></Shot>
        <Shot beat={1} through={2}><SpreadTwo /></Shot>
      </div>
      <fx.Vignette strength={0.18} color="#5A4A30" />
      <fx.Grain opacity={0.07} />
    </>
  );
};
