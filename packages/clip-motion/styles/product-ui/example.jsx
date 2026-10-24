// Product UI: the interface is the subject. Light field, layered soft shadows, a gentle 3D tilt that settles,
// a cursor that does the feature, the result confirmed by a toast.
const { Text, Mark, fx } = kit;
const { useCurrentFrame } = R;

const FIELD = '#F1F2EE';
const FIELD2 = '#E4E7E1';
const INK = '#16181D';
const MUTED = '#6B7280';
const ACCENT = '#FF5A36';
const AMBER = '#F5A524';
const W = kit.width;
const H = kit.height;
const b = kit.beat;

const WIN = { w: Math.round(W * 0.86), h: Math.round(H * 0.25) };
WIN.x = Math.round((W - WIN.w) / 2);
WIN.y = Math.round(H * 0.36);
const PAD = 44;
const CHIP = { size: 54, h: 92, gap: 16, padX: 24 };
const WORDS = ['So', 'um,', 'this', 'is', 'how', 'uh', 'you', 'cut', 'a', 'video', 'by', 'words.'];
const FILLERS = new Set([1, 5]);
const widths = WORDS.map((word) => kit.measure(word, { size: CHIP.size, font: 'Inter', weight: 600 }) + CHIP.padX * 2);
// Lay chips in rows inside the window; `gone` 0..1 shrinks the fillers to nothing so the rest closes up.
const layout = (gone) => {
  let x = 0;
  let row = 0;
  const inner = WIN.w - PAD * 2;
  return WORDS.map((word, i) => {
    const w = FILLERS.has(i) ? widths[i] * (1 - gone) : widths[i];
    const gap = FILLERS.has(i) ? CHIP.gap * (1 - gone) : CHIP.gap;
    if (x + w > inner && x > 0) {
      x = 0;
      row += 1;
    }
    const spot = { x, y: row * (CHIP.h + CHIP.gap), w };
    x += w + gap;
    return spot;
  });
};
const TARGET = layout(0)[1];
const CURSOR_TO = [WIN.x + PAD + TARGET.x + TARGET.w * 0.55, WIN.y + 120 + TARGET.y + CHIP.h * 0.6];

function Cursor({ f }) {
  const t = kit.tween(f, [b(1).from, b(1).from + 22], [0, 1], 'smooth');
  const x = W * 0.86 + (CURSOR_TO[0] - W * 0.86) * t;
  const y = H * 0.78 + (CURSOR_TO[1] - H * 0.78) * t;
  const press = f >= b(1).from + 24 && f < b(1).from + 30 ? 0.86 : 1;
  const show = kit.tween(f, [b(1).from - 6, b(1).from + 4], [0, 1], 'soft') * kit.tween(f, [b(3).from, b(3).from + 8], [1, 0], 'in');
  if (show <= 0) return null;
  return (
    <svg width={56} height={64} viewBox="0 0 28 32" style={{ position: 'absolute', left: x - 6, top: y - 4, opacity: show, transform: `scale(${press})`, transformOrigin: '6px 4px', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))' }}>
      <path d="M 3 2 L 3 26 L 9 20 L 13 30 L 17 28 L 13 18 L 22 18 Z" fill="#FFFFFF" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

return function Scene() {
  const f = useCurrentFrame();
  const rise = kit.tween(f, [b(0).from, b(0).from + 28], [0, 1], 'out');
  const tilt = 16 * (1 - rise);
  const struck = kit.tween(f, [b(1).from + 26, b(1).from + 34], [0, 1], 'out');
  const gone = kit.tween(f, [b(2).from, b(2).from + 22], [0, 1], 'snap');
  const toast = kit.tween(f, [b(3).from, b(3).from + 18], [0, 1], 'back');
  const push = kit.tween(f, [0, kit.frames], [1, 1.04], 'linear');
  const spots = layout(gone);
  return (
    <>
      <fx.Fill color={FIELD} to={FIELD2} />
      <Text text="Cut by words." x={W / 2} y={H * 0.15} size={Math.round(W * 0.095)} font="Plus Jakarta Sans" weight={800} tracking={-0.035} color={INK} align="center" style={{ opacity: rise, transform: `translateY(${(1 - rise) * 30}px)` }} />
      <Text text="Click a word. It's gone." x={W / 2} y={H * 0.15 + W * 0.13} size={42} font="Inter" weight={500} color={MUTED} align="center" style={{ opacity: rise }} />
      <div style={{ position: 'absolute', inset: 0, perspective: 1600, transform: `scale(${push})`, transformOrigin: '50% 50%' }}>
        <Mark name="app window" x={WIN.x} y={WIN.y} w={WIN.w} h={WIN.h}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 36, background: '#FFFFFF', transform: `translateY(${(1 - rise) * 120}px) rotateX(${tilt}deg)`, transformOrigin: '50% 100%', opacity: rise, boxShadow: '0 1px 2px rgba(16,24,40,0.06), 0 12px 24px rgba(16,24,40,0.08), 0 40px 80px rgba(16,24,40,0.14)', overflow: 'hidden' }}>
            <div style={{ height: 76, borderBottom: '1px solid #ECEDEA', display: 'flex', alignItems: 'center', gap: 14, paddingLeft: 32 }}>
              {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <div key={c} style={{ width: 18, height: 18, borderRadius: 9, background: c }} />)}
              <div style={{ marginLeft: 24, fontFamily: kit.font.Inter, fontSize: 30, fontWeight: 600, color: MUTED }}>launch-video.mp4 · Transcript</div>
            </div>
            <div style={{ position: 'absolute', left: PAD, top: 120 }}>
              {WORDS.map((word, i) => {
                const filler = FILLERS.has(i);
                const s = spots[i];
                if (filler && gone >= 1) return null;
                return (
                  <div key={word + i} style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: CHIP.h, borderRadius: 18, overflow: 'hidden', background: filler ? `rgba(245, 165, 36, ${0.16 - 0.08 * struck})` : '#F4F5F2', border: filler ? `2px solid rgba(245, 165, 36, ${0.7 - 0.4 * struck})` : '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: filler ? 1 - gone : 1 }}>
                    <span style={{ fontFamily: kit.font.Inter, fontSize: CHIP.size, fontWeight: 600, color: filler ? AMBER : INK, textDecoration: struck > 0.5 && filler ? 'line-through' : 'none', opacity: filler ? 1 - 0.5 * struck : 1, whiteSpace: 'nowrap' }}>{word}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Mark>
      </div>
      <Cursor f={f} />
      <div style={{ position: 'absolute', left: W / 2, top: H * 0.74, transform: `translate(-50%, ${(1 - toast) * 80}px)`, opacity: Math.min(1, toast * 1.5), display: 'flex', alignItems: 'center', gap: 18, padding: '22px 34px', borderRadius: 999, background: INK, boxShadow: '0 20px 40px rgba(16,24,40,0.25)' }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: ACCENT }} />
        <Text text="2 fillers removed" x={0} y={0} size={40} font="Inter" weight={600} color="#FFFFFF" style={{ position: 'relative' }} />
      </div>
      <fx.Grain opacity={0.035} />
    </>
  );
};
