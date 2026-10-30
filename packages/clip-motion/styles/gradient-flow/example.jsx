// Gradient flow: a mesh gradient that never stops moving, one big number, frosted glass capsules filling like a chart.
const { Text, Mark, fx } = kit;
const { useCurrentFrame } = R;

const FIELD = ['#0E0B24', '#5B3DF5', '#FF6A3D', '#14B8A6'];
const INK = '#FFFFFF';
const SOFT = 'rgba(255, 255, 255, 0.72)';
const FILL = 'linear-gradient(90deg, #FFD3B8 0%, #FFFFFF 100%)';

const W = kit.width;
const H = kit.height;
const M = Math.round(W * 0.09);
const NUMBER = 3.2;
const ROWS = [
  { label: 'WEEK 1', value: 0.38, text: '1.4×' },
  { label: 'WEEK 2', value: 0.66, text: '2.3×' },
  { label: 'WEEK 3', value: 1, text: '3.2×' },
];
const CAP = { x: M, w: W - 2 * M, h: Math.round(H * 0.06), gap: Math.round(H * 0.028), top: Math.round(H * 0.5) };

const b = kit.beat;

function Capsule({ row, i }) {
  const f = useCurrentFrame();
  const at = b(1).from + i * 7;
  const grow = kit.tween(f, [at, at + 26], [0, row.value], 'out');
  const enter = kit.tween(f, [at - 8, at + 6], [0, 1], 'soft');
  const y = CAP.top + i * (CAP.h + CAP.gap);
  return (
    <Mark name={`capsule ${i + 1}`} x={CAP.x} y={y} w={CAP.w} h={CAP.h} at={at - 8}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: CAP.h, background: 'rgba(255, 255, 255, 0.10)', border: '1.5px solid rgba(255, 255, 255, 0.28)', backdropFilter: 'blur(24px)', boxShadow: '0 20px 60px rgba(10, 6, 40, 0.35), inset 0 1px 0 rgba(255,255,255,0.35)', opacity: enter, transform: `translateY(${(1 - enter) * 24}px)`, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: `calc(${grow * 100}% - 12px)`, borderRadius: CAP.h, background: FILL, boxShadow: '0 0 30px rgba(255, 210, 180, 0.55)' }} />
      </div>
    </Mark>
  );
}

return function Scene() {
  const f = useCurrentFrame();
  const roll = kit.tween(f, [b(0).from + 6, b(0).from + 40], [0, NUMBER], 'out');
  const rise = kit.tween(f, [b(0).from, b(0).from + 22], [40, 0], 'out');
  const fade = kit.tween(f, [b(0).from, b(0).from + 14], [0, 1], 'soft');
  return (
    <>
      <fx.GradientField colors={FIELD} speed={1.3} softness={170} seed={4} />
      <fx.Vignette strength={0.35} color="#0E0B24" />
      <Text text="MORE VIEWS PER POST" x={W / 2} y={H * 0.17} size={42} font="Inter" weight={600} tracking={0.16} color={SOFT} align="center" style={{ opacity: fade }} />
      <Text name="count" text={`${roll.toFixed(1)}×`} x={W / 2} y={H * 0.205} size={Math.round(W * 0.3)} font="Unbounded" weight={800} tracking={-0.04} lineHeight={1} color={INK} align="center" style={{ opacity: fade, transform: `translateY(${rise}px)`, textShadow: '0 12px 60px rgba(20, 8, 60, 0.35)' }} />
      {ROWS.map((row, i) => (
        <React.Fragment key={row.label}>
          <Capsule row={row} i={i} />
          <Text name={`label ${i + 1}`} text={row.label} x={CAP.x + 8} y={CAP.top + i * (CAP.h + CAP.gap) - 54} size={38} font="Inter" weight={600} tracking={0.12} color={SOFT} at={b(1).from + i * 7} />
          <Text name={`value ${i + 1}`} text={row.text} x={CAP.x + CAP.w - 8} y={CAP.top + i * (CAP.h + CAP.gap) - 54} size={38} font="Inter" weight={700} color={INK} align="right" at={b(1).from + i * 7 + 20} />
        </React.Fragment>
      ))}
      <fx.LightSweep at={b(2).from + 4} dur={36} angle={18} width={0.4} color="rgba(255, 255, 255, 0.22)" />
      <fx.Grain opacity={0.05} />
    </>
  );
};
