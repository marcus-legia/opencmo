// Paper cutout: stacked layers of cut paper with real shadows, parallax entrances, a stop-motion step (on twos).
const { Text, Mark, fx } = kit;
const { useCurrentFrame } = R;

const SKY = '#FCE9D8';
const SKY2 = '#F8D7C0';
const LAYERS = ['#F4B183', '#E8875E', '#C9634A', '#8E3F3A'];
const SUN = '#FFCF5C';
const PAPER = '#FFF8EE';
const INK = '#3A2421';
const W = kit.width;
const H = kit.height;
const b = kit.beat;
const shadow = 'drop-shadow(0 10px 14px rgba(70, 30, 20, 0.28)) drop-shadow(0 2px 3px rgba(70, 30, 20, 0.25))';
// Stop-motion: hold every pose for two frames, with a tiny seeded wobble per pose.
const onTwos = (f) => f - (f % 2);
const wob = (seed, f) => kit.noise(seed)(onTwos(f) * 0.37) * 3;

// A hill layer: a wavy top edge across the frame, filled down to the bottom.
const hill = (base, amp, phase) => {
  const pts = Array.from({ length: 9 }, (_, i) => [(i / 8) * W, base + amp * Math.sin(i * 1.3 + phase)]);
  let d = `M -40 ${H + 40} L -40 ${pts[0][1]}`;
  pts.forEach(([x, y], i) => {
    if (i === 0) return;
    const [px, py] = pts[i - 1];
    d += ` C ${px + W / 24} ${py} ${x - W / 24} ${y} ${x} ${y}`;
  });
  return `${d} L ${W + 40} ${pts[8][1]} L ${W + 40} ${H + 40} Z`;
};
const HILLS = LAYERS.map((color, i) => ({ color, d: hill(H * (0.5 + i * 0.08), 34 + i * 10, i * 1.7) }));
const PATH = `M ${W * 0.12} ${H * 0.8} C ${W * 0.4} ${H * 0.76} ${W * 0.2} ${H * 0.66} ${W * 0.48} ${H * 0.63} S ${W * 0.75} ${H * 0.55} ${W * 0.82} ${H * 0.5}`;
const TITLE = Math.round(W * 0.1);
const FLAGS = [[0.3, 0.72], [0.55, 0.615], [0.8, 0.505]];

return function Scene() {
  const f = useCurrentFrame();
  const t = onTwos(f);
  const sun = kit.tween(t, [b(0).from + 18, b(0).from + 32], [0, 1], 'back');
  const strip = kit.tween(t, [b(1).from, b(1).from + 14], [0, 1], 'back');
  const path = kit.tween(t, [b(1).from + 10, b(1).from + 40], [0, 1], 'smooth');
  return (
    <>
      <fx.Fill color={SKY} to={SKY2} />
      <Mark name="sun" x={W * 0.56} y={H * 0.27} w={W * 0.3} h={W * 0.3}>
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: SUN, filter: shadow, transform: `scale(${sun}) translate(${wob(9, f)}px, ${wob(10, f)}px)` }} />
      </Mark>
      <Mark name="hills" x={0} y={H * 0.45} w={W} h={H * 0.4}>
        <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: -H * 0.45, overflow: 'visible' }}>
          {HILLS.map((layer, i) => {
            const rise = kit.tween(t, [b(0).from + i * 4, b(0).from + 18 + i * 4], [H * (0.35 + i * 0.05), 0], 'out');
            return <path key={i} d={layer.d} fill={layer.color} style={{ filter: shadow }} transform={`translate(${wob(i + 1, f)} ${rise + wob(i + 20, f)})`} />;
          })}
          <path d={PATH} fill="none" stroke={PAPER} strokeWidth={14} strokeLinecap="round" strokeDasharray="0.02 0.018" pathLength={1} strokeDashoffset={0} style={{ filter: shadow, clipPath: `inset(0 ${(1 - path) * 100}% 0 0)` }} />
          {FLAGS.map(([u, v], i) => {
            const pop = kit.tween(t, [b(2).from + i * 6, b(2).from + 10 + i * 6], [0, 1], 'back');
            return (
              <g key={i} transform={`translate(${W * u} ${H * v}) scale(${pop})`} style={{ filter: shadow }}>
                <rect x={-4} y={-110} width={8} height={110} fill={PAPER} />
                <path d="M 4 -110 L 70 -88 L 4 -66 Z" fill={i === 2 ? SUN : PAPER} />
              </g>
            );
          })}
        </svg>
      </Mark>
      {f >= b(1).from ? (
        <div style={{ position: 'absolute', left: W * 0.08, top: H * 0.12, width: TITLE * 6.2, height: TITLE * 2.18 + 52, transform: `translateY(${(1 - strip) * -260}px) rotate(${-2 + wob(31, f) * 0.2}deg)`, background: PAPER, filter: shadow }}>
          <Text text="PLAN YOUR" x={40} y={26} size={TITLE} font="Archivo Black" weight={400} color={INK} lineHeight={1.02} />
          <Text text="WEEK." x={40} y={26 + TITLE * 1.16} size={TITLE} font="Archivo Black" weight={400} color={LAYERS[2]} lineHeight={1.02} />
        </div>
      ) : null}
      <fx.Grain opacity={0.08} />
    </>
  );
};
