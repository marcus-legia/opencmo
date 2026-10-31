// Direction: warm paper. Field #F4EFE6 → #E9E1D3, ink #1D2733, teal #0E9E86 (the body's side), red #D9384E (the virus),
// grey #9AA6B8 (harmless). Type: DM Serif Display for beat titles, Inter 600 for steps. Motion: out entrances, smooth moves.
const { Mark, Text, Shot, fx } = kit;
const { useCurrentFrame } = R;
const INK = '#1D2733';
const TEAL = '#0E9E86';
const RED = '#D9384E';
const GREY = '#9AA6B8';
const W = kit.width;
const H = kit.height;
const full = kit.area('full');
const MID = full.y + full.h * 0.56;
const b = kit.beat;

// A virus: a disc with spikes; `t` 0..1 grows the spikes.
function Virus({ x, y, r, color, t = 1, rot = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const len = r * 0.35 * t;
        return <g key={i}><line x1={Math.cos(a) * r} y1={Math.sin(a) * r} x2={Math.cos(a) * (r + len)} y2={Math.sin(a) * (r + len)} stroke={color} strokeWidth={r * 0.09} strokeLinecap="round" /><circle cx={Math.cos(a) * (r + len)} cy={Math.sin(a) * (r + len)} r={r * 0.09 * t} fill={color} /></g>;
      })}
      <circle r={r} fill={color} />
      <circle r={r * 0.62} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={r * 0.06} />
    </g>
  );
}

// An antibody: a Y.
function Antibody({ x, y, s, rot = 0 }) {
  return <path transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} d="M 0 40 L 0 0 M 0 0 L -22 -30 M 0 0 L 22 -30" stroke={TEAL} strokeWidth={10} strokeLinecap="round" fill="none" />;
}

function Title({ text }) {
  const s = kit.useShot();
  const rise = kit.travel(kit.tween(s.frame, [0, 18], [0, 1], 'linear'), 60, { overshoot: 6 });
  const out = kit.tween(s.frame, [s.frames - 8, s.frames], [1, 0], 'in');
  return <Text text={text} x={W / 2} y={full.y + full.h * 0.04} size={Math.round(W * 0.042)} font="DM Serif Display" weight={400} color={INK} align="center" style={{ transform: `translateY(${rise}px)`, opacity: Math.min(out, kit.tween(s.frame, [0, 8], [0, 1], 'soft')) }} />;
}

function Syringe() {
  const s = kit.useShot();
  const x = kit.tween(s.frame, [3, 24], [-500, W * 0.33], 'out');
  const shield = kit.tween(s.frame, [20, 50], [0, 1], 'smooth');
  return (
    <>
      <Mark name="syringe" x={W * 0.33 - 220} y={MID - 60} w={440} h={120}>
        <svg width={440} height={120} style={{ overflow: 'visible', transform: `translateX(${x - W * 0.33}px)` }}>
          <rect x={60} y={30} width={260} height={60} rx={12} fill="#FFFFFF" stroke={INK} strokeWidth={8} />
          <rect x={70} y={40} width={160} height={40} rx={6} fill={TEAL} fillOpacity={0.6} />
          <path d="M 0 60 L 60 60 M 20 30 L 20 90" stroke={INK} strokeWidth={10} strokeLinecap="round" />
          <path d="M 320 60 L 430 60" stroke={INK} strokeWidth={5} strokeLinecap="round" />
        </svg>
      </Mark>
      <Mark name="shield" x={W * 0.73 - 120} y={MID - 140} w={240} h={280}>
        <svg width={240} height={280} viewBox="0 0 240 280">
          <path d="M 120 10 L 225 50 L 210 170 Q 190 240 120 270 Q 50 240 30 170 L 15 50 Z" fill={TEAL} fillOpacity={0.15 * shield} stroke={TEAL} strokeWidth={10} strokeLinejoin="round" {...kit.drawOn(shield)} />
        </svg>
      </Mark>
    </>
  );
}

function Fragments() {
  const s = kit.useShot();
  const pop = kit.tween(s.frame, [0, 14], [0, 1], 'back');
  const split = kit.tween(s.frame, [s.frames * 0.45, s.frames * 0.45 + 18], [0, 1], 'out');
  return (
    <Mark name="virus" x={W / 2 - 300} y={MID - 220} w={600} h={440}>
      <svg width={600} height={440} style={{ overflow: 'visible' }}>
        {split < 1 ? <g opacity={1 - split}><Virus x={300} y={220} r={110 * pop} color={RED} t={pop} rot={s.frame * 0.6} /></g> : null}
        {[[-1, -0.4], [1, -0.3], [0, 1]].map(([dx, dy], i) => <g key={i} opacity={split}><Virus x={300 + dx * 170 * split} y={220 + dy * 140 * split} r={40} color={GREY} t={0.6} rot={i * 40} /></g>)}
      </svg>
    </Mark>
  );
}

function Antibodies() {
  const s = kit.useShot();
  const make = (i) => kit.tween(s.frame, [20 + i * 6, 44 + i * 6], [0, 1], 'out');
  return (
    <Mark name="immune cell" x={W * 0.24} y={MID - 200} w={W * 0.52} h={400}>
      <svg width={W * 0.52} height={400} style={{ overflow: 'visible' }}>
        <circle cx={170} cy={200} r={150} fill={TEAL} fillOpacity={0.14} stroke={TEAL} strokeWidth={8} />
        <circle cx={150} cy={190} r={55} fill={TEAL} fillOpacity={0.5} />
        {[0, 1, 2].map((i) => <g key={i} opacity={make(i)}><Antibody x={330 + make(i) * (150 + i * 50)} y={110 + i * 95} s={1.4} rot={90} /></g>)}
        <Virus x={W * 0.52 - 60} y={200} r={40} color={GREY} t={0.6} />
      </svg>
    </Mark>
  );
}

function Defence() {
  const s = kit.useShot();
  const come = kit.tween(s.frame, [0, s.frames * 0.5], [W * 0.95, W * 0.62], 'smooth');
  const lock = kit.tween(s.frame, [s.frames * 0.5, s.frames * 0.5 + 16], [0, 1], 'snap');
  return (
    <Mark name="defence" x={W * 0.2} y={MID - 200} w={W * 0.6} h={400}>
      <svg width={W} height={400} style={{ position: 'absolute', left: -W * 0.2, overflow: 'visible' }}>
        <Virus x={come + lock * 40} y={200} r={100} color={lock > 0.5 ? GREY : RED} t={1 - 0.4 * lock} rot={s.frame} />
        {[-50, 0, 50].map((dy, i) => <Antibody key={i} x={come - 160 + lock * 70} y={200 + dy} s={1.2} rot={90} />)}
      </svg>
    </Mark>
  );
}

function Steps() {
  const s = kit.useShot();
  const lines = ['1  Show a piece', '2  Build antibodies', '3  Remember them'];
  const rail = kit.tween(s.frame, [0, 30], [0, 1], 'smooth');
  const rows = lines.map((line, i) => {
    const at = Math.min(kit.cue(4, ['show', 'build', 'remember'][i]) - b(4).from, i * 8);
    const u = kit.tween(s.frame, [at, at + 16], [0, 1], 'out');
    return <Text key={line} name={`step ${i + 1}`} text={line} x={W * 0.14} y={MID - 210 + i * 140} size={100} font="Inter" weight={600} color={i === 2 ? TEAL : INK} style={{ opacity: u, transform: `translateX(${(1 - u) * 60}px)` }} />;
  });
  return (
    <>
      <Mark name="steps rail" x={W * 0.08} y={MID - 230} w={W * 0.7} h={460}>
        <svg width={60} height={460} style={{ overflow: 'visible' }}>
          <path d="M 30 50 L 30 400" stroke={TEAL} strokeWidth={6} strokeLinecap="round" {...kit.drawOn(rail)} />
          {[0, 1, 2].map((i) => <circle key={i} cx={30} cy={70 + i * 140} r={14 * Math.min(1, rail * 3 - i)} fill={TEAL} />)}
        </svg>
      </Mark>
      {rows}
    </>
  );
}

function Protected() {
  const s = kit.useShot();
  const draw = kit.tween(s.frame, [0, 26], [0, 1], 'smooth');
  const tick = kit.tween(s.frame, [20, 36], [0, 1], 'out');
  return (
    <Mark name="protected" x={W / 2 - 150} y={MID - 170} w={300} h={340}>
      <svg width={300} height={340} viewBox="0 0 240 280">
        <path d="M 120 10 L 225 50 L 210 170 Q 190 240 120 270 Q 50 240 30 170 L 15 50 Z" fill={TEAL} fillOpacity={0.18 * draw} stroke={TEAL} strokeWidth={10} strokeLinejoin="round" {...kit.drawOn(draw)} />
        <path d="M 70 140 L 105 175 L 175 100" stroke={INK} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" {...kit.drawOn(tick)} />
      </svg>
    </Mark>
  );
}

return function Scene() {
  return (
    <>
      <fx.Fill color="#F4EFE6" to="#E9E1D3" />
      {/* The subjects are drawn at a comfortable size and scaled up together around the mid line. */}
      <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.45)', transformOrigin: `50% ${MID}px` }}>
        <Shot beat={0}><Syringe /></Shot>
        <Shot beat={1}><Fragments /></Shot>
        <Shot beat={2}><Antibodies /></Shot>
        <Shot beat={3}><Defence /></Shot>
        <Shot beat={5}><Protected /></Shot>
      </div>
      <Shot beat={4}><Steps /></Shot>
      {['Training, not fighting', 'A harmless piece', 'Antibodies that fit', 'Ready for the real virus', 'Three steps', 'Protected'].map((text, i) => <Shot key={text} beat={i}><Title text={text} /></Shot>)}
      <fx.Vignette strength={0.25} color="#8A7A60" />
      <fx.Grain opacity={0.04} />
    </>
  );
};
