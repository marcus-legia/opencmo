/**
 * The explainer guide's example scene (read_guide "explainer"): a subject drawn in scene code inside kit.Mark, with
 * its own curves, instead of icons. Rendered in golden.test.ts so the example the model copies always compiles and
 * passes the layout report.
 */

export const EXPLAINER_EXAMPLE_BEATS: { say: string; label: string; visual: string }[] = [
	{
		say: 'Stand on a beach and the sea looks perfectly flat, right to the horizon.',
		label: 'The sea looks flat',
		visual: 'a person on the shore; the horizon draws on as a straight gold line over a calm sea',
	},
	{
		say: 'Pull back far enough, and that straight line bends into the edge of a huge circle.',
		label: 'Zoom out: it curves',
		visual: 'the sea shrinks into a globe; the same line bends into its top edge, the person rides it',
	},
	{
		say: 'That is why a ship sailing away disappears hull first, mast last.',
		label: 'Hull first, mast last',
		visual: 'a dashed sight line from the eye grazes the curve; a ship sails past it and sinks hull-first',
	},
];

export const EXPLAINER_EXAMPLE = `// Direction: night sea. Field #07111F → #0E2A47, sea #1AA39A → #06343F, ink #EAF4F4, accent #F5C451 (the horizon).
// Type: Fraunces 600 for the beat titles, Inter 500 for small labels. Motion: smooth moves, back for the title entrances.
const { Mark, Text, Shot, Streak, fx } = kit;
const { useCurrentFrame } = R;
const SKY = '#07111F';
const SKY2 = '#0E2A47';
const SEA = '#1AA39A';
const DEEP = '#06343F';
const INK = '#EAF4F4';
const GOLD = '#F5C451';
const W = kit.width;
const H = kit.height;
const box = kit.area('full');
const b = kit.beat;
const deg = Math.PI / 180;

// The planet: a circle whose TOP stays at TOP_Y while its radius shrinks, so one line goes from flat to round.
const CX = W / 2;
const TOP_Y = box.y + box.h * 0.5;
const R_FLAT = 40000;
const R_GLOBE = W * 0.42;
const EYE = 90;
const onCircle = (r, a, lift = 0) => [CX + (r + lift) * Math.sin(a), TOP_Y + r - (r + lift) * Math.cos(a)];
const arc = (r, half) => {
  const [x0, y0] = onCircle(r, -half);
  const [x1, y1] = onCircle(r, half);
  return \`M \${x0} \${y0} A \${r} \${r} 0 \${half > Math.PI / 2 ? 1 : 0} 1 \${x1} \${y1}\`;
};
const STARS = Array.from({ length: 70 }, (_, i) => {
  const rnd = kit.random(i + 11);
  return { x: rnd() * W, y: rnd() * H * 0.6, r: 1 + rnd() * 2.2, phase: rnd() * 6 };
});

// One beat title per shot: it travels up into place with a capped overshoot and a vertical streak.
function Title({ text }) {
  const s = kit.useShot();
  const u = kit.tween(s.frame, [0, 20], [0, 1], 'linear');
  const offset = kit.travel(u, 160, { overshoot: 10 });
  const speed = offset - kit.travel(kit.tween(s.frame - 1, [0, 20], [0, 1], 'linear'), 160, { overshoot: 10 });
  const fade = kit.tween(s.frame, [s.frames - 10, s.frames], [1, 0], 'in');
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, transform: \`translateY(\${offset}px)\`, opacity: Math.min(fade, kit.tween(s.frame, [0, 8], [0, 1], 'soft')) }}>
      <Streak speed={speed} size={120} axis="y">
        <Text text={text} x={W / 2} y={box.y + box.h * 0.08} size={Math.round(W * 0.085)} font="Fraunces" weight={600} tracking={-0.02} color={INK} align="center" />
      </Streak>
    </div>
  );
}

function Person({ r, a }) {
  const [x, y] = onCircle(r, a);
  return (
    <g transform={\`translate(\${x} \${y}) rotate(\${a / deg}) scale(1.5)\`}>
      <path d="M -9 0 L 0 -38 L 9 0 M 0 -38 L 0 -62 M 0 -54 L 16 -44" stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
      <circle cx={0} cy={-EYE / 1.5} r={9} fill={INK} />
    </g>
  );
}

function Ship({ r, a }) {
  const [x, y] = onCircle(r, a);
  return (
    <g transform={\`translate(\${x} \${y}) rotate(\${a / deg}) scale(1.6)\`}>
      <path d="M -46 -4 L 46 -4 L 32 18 L -32 18 Z" fill={GOLD} />
      <path d="M 0 -4 L 0 -96" stroke={INK} strokeWidth={5} />
      <path d="M 4 -90 L 44 -26 L 4 -26 Z" fill={INK} />
    </g>
  );
}

return function Scene() {
  const f = useCurrentFrame();
  const draw = kit.tween(f, [kit.at(0, 0.15), kit.at(0, 0.6)], [0, 1], 'smooth');
  // Beat 2: the radius shrinks on a log scale (a straight interpolation would stay flat until the very end).
  const zoom = kit.tween(f, [b(1).from + 4, kit.at(1, 0.75)], [0, 1], 'smooth');
  const r = Math.exp(Math.log(R_FLAT) + (Math.log(R_GLOBE) - Math.log(R_FLAT)) * zoom);
  const half = Math.min(Math.asin(Math.min(1, (W * 0.46) / r)) + kit.tween(zoom, [0.7, 1], [0, 90 * deg], 'smooth'), 179 * deg);
  const personA = -Math.min(Math.asin(Math.min(1, (W * 0.22) / r)), 32 * deg);
  // Beat 3: the sight line grazes the sea where it leaves the eye; the ship sails past that point.
  const tangentA = personA + Math.acos(r / (r + EYE));
  const sail = kit.tween(f, [b(2).from + 6, kit.at(2, 0.9)], [0, 1], 'smooth');
  const shipA = personA + (tangentA - personA) * (0.45 + 1.6 * sail);
  const [ex, ey] = onCircle(r, personA, EYE);
  const [tx, ty] = onCircle(r, tangentA);
  const dx = tx - ex;
  const dy = ty - ey;
  const len = Math.hypot(dx, dy) || 1;
  const far = [ex + (dx / len) * W * 2, ey + (dy / len) * W * 2];
  const up = [dy / len, -dx / len];
  const seen = \`M \${ex - (dx / len) * W} \${ey - (dy / len) * W} L \${far[0]} \${far[1]} L \${far[0] + up[0] * W * 2} \${far[1] + up[1] * W * 2} L \${ex + up[0] * W * 2} \${ey + up[1] * W * 2} Z\`;
  const push = kit.tween(f, [0, kit.frames], [1, 1.04], 'linear');
  return (
    <>
      <fx.Fill color={SKY} to={SKY2} angle={180} />
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {STARS.map((star, i) => <circle key={i} cx={star.x} cy={star.y} r={star.r} fill={INK} opacity={0.25 + 0.35 * (0.5 + 0.5 * Math.sin(f / 14 + star.phase))} />)}
      </svg>
        <Mark name="planet" x={box.x} y={TOP_Y - box.h * 0.12} w={box.w} h={box.h * 0.6}>
          <svg width={W} height={H} viewBox={\`0 0 \${W} \${H}\`} style={{ position: 'absolute', left: -box.x, top: -(TOP_Y - box.h * 0.12), overflow: 'visible', transform: \`scale(\${push})\`, transformOrigin: \`50% \${TOP_Y}px\` }}>
            <defs>
              <linearGradient id="sea" gradientUnits="userSpaceOnUse" x1="0" y1={TOP_Y} x2="0" y2={TOP_Y + box.h * 0.55}>
                <stop offset="0" stopColor={SEA} />
                <stop offset="0.35" stopColor={DEEP} />
                <stop offset="1" stopColor={SKY} />
              </linearGradient>
              <clipPath id="seen"><path d={seen} /></clipPath>
            </defs>
            <circle cx={CX} cy={TOP_Y + r} r={r} fill="url(#sea)" />
            <path d={arc(r, half)} fill="none" stroke={GOLD} strokeWidth={7} strokeLinecap="round" {...kit.drawOn(draw)} style={{ filter: \`drop-shadow(0 0 10px \${GOLD})\` }} />
            <Person r={r} a={personA} />
            {f >= b(2).from ? (
              <>
                <path d={\`M \${ex} \${ey} L \${far[0]} \${far[1]}\`} stroke={INK} strokeOpacity={0.55} strokeWidth={3} strokeDasharray="10 12" />
                <g opacity={0.22}><Ship r={r} a={shipA} /></g>
                <g clipPath="url(#seen)"><Ship r={r} a={shipA} /></g>
              </>
            ) : null}
          </svg>
        </Mark>
      <Shot beat={0}><Title text="The sea looks flat" /></Shot>
      <Shot beat={1}><Title text="Zoom out: it curves" /></Shot>
      <Shot beat={2}><Title text="Hull first, mast last" /></Shot>
      <fx.Vignette strength={0.45} />
      <fx.Grain opacity={0.05} />
    </>
  );
};`;
