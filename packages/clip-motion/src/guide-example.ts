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

export const EXPLAINER_EXAMPLE = `const { Stage, Headline, Mark } = kit;
const { useCurrentFrame, interpolate, Easing } = R;
const b = kit.beat;
const box = kit.area('full');
const W = box.w;
const H = box.h;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
// Named curves: a smooth move, and an entrance with a small overshoot (about 3%) that settles.
const smooth = Easing.bezier(0.65, 0, 0.35, 1);
const settle = Easing.bezier(0.34, 1.12, 0.64, 1);
const deg = Math.PI / 180;

// The planet: a circle whose TOP stays at TOP_Y while its radius shrinks, so the same line goes from flat to round.
const CX = W / 2;
const TOP_Y = H * 0.36;
const R_FLAT = 40000;
const R_GLOBE = W * 0.44;
const EYE = 90; // eye height above the sea, exaggerated so the sight line is visible
const onCircle = (r, a, lift = 0) => [CX + (r + lift) * Math.sin(a), TOP_Y + r - (r + lift) * Math.cos(a)];
const arc = (r, half) => {
  const [x0, y0] = onCircle(r, -half);
  const [x1, y1] = onCircle(r, half);
  return \`M \${x0} \${y0} A \${r} \${r} 0 \${half > Math.PI / 2 ? 1 : 0} 1 \${x1} \${y1}\`;
};

function Person({ r, a }) {
  const [x, y] = onCircle(r, a);
  return (
    <g transform={\`translate(\${x} \${y}) rotate(\${a / deg}) scale(1.4)\`}>
      <path d="M -9 0 L 0 -38 L 9 0 M 0 -38 L 0 -62 M 0 -54 L 16 -44" stroke={kit.color.text} strokeWidth={6} strokeLinecap="round" fill="none" />
      <circle cx={0} cy={-EYE / 1.4} r={9} fill={kit.color.text} />
    </g>
  );
}

function Ship({ r, a }) {
  const [x, y] = onCircle(r, a);
  return (
    <g transform={\`translate(\${x} \${y}) rotate(\${a / deg}) scale(1.5)\`}>
      <path d="M -46 -4 L 46 -4 L 32 18 L -32 18 Z" fill={kit.color.answer} />
      <path d="M 0 -4 L 0 -96" stroke={kit.color.text} strokeWidth={5} />
      <path d="M 4 -90 L 44 -26 L 4 -26 Z" fill={kit.color.text} />
    </g>
  );
}

return function Scene() {
  const frame = useCurrentFrame();
  // Beat 1: the horizon draws on, left to right.
  const draw = interpolate(frame, [kit.at(0, 0.1), kit.at(0, 0.55)], [1, 0], { ...clamp, easing: smooth });
  // Beat 2: the radius shrinks on a log scale (a straight interpolation would stay flat until the very end).
  const zoom = interpolate(frame, [b(1).from + 4, kit.at(1, 0.75)], [0, 1], { ...clamp, easing: settle });
  const r = Math.exp(Math.log(R_FLAT) + (Math.log(R_GLOBE) - Math.log(R_FLAT)) * Math.min(zoom, 1));
  // Once it is a globe, the line keeps going round it.
  const half = Math.min(Math.asin(Math.min(1, (W * 0.46) / r)) + interpolate(zoom, [0.7, 1], [0, 90 * deg], clamp), 179 * deg);
  const personA = -Math.min(Math.asin(Math.min(1, (W * 0.22) / r)), 32 * deg);
  // Beat 3: the sight line grazes the sea where it leaves the eye; the ship sails from near to beyond that point.
  const tangentA = personA + Math.acos(r / (r + EYE));
  const sail = interpolate(frame, [b(2).from + 6, kit.at(2, 0.9)], [0, 1], { ...clamp, easing: smooth });
  const shipA = personA + (tangentA - personA) * (0.45 + 1.6 * sail);
  const lineIn = interpolate(frame, [b(2).from, b(2).from + 14], [1, 0], { ...clamp, easing: smooth });
  const [ex, ey] = onCircle(r, personA, EYE);
  const [tx, ty] = onCircle(r, tangentA);
  const dx = tx - ex;
  const dy = ty - ey;
  const len = Math.hypot(dx, dy) || 1;
  const far = [ex + (dx / len) * W * 2, ey + (dy / len) * W * 2];
  // Everything above the sight line is what the eye can see: a half-plane, as a big polygon.
  const up = [dy / len, -dx / len];
  const seen = \`M \${ex - (dx / len) * W} \${ey - (dy / len) * W} L \${far[0]} \${far[1]} L \${far[0] + up[0] * W * 2} \${far[1] + up[1] * W * 2} L \${ex + up[0] * W * 2} \${ey + up[1] * W * 2} Z\`;
  const shimmer = interpolate(zoom, [0, 0.3], [1, 0], clamp);
  return (
    <Stage ambient>
      <Mark name="planet" x={box.x} y={box.y} w={W} h={H} at={b(0).from}>
        <svg width={W} height={H} viewBox={\`0 0 \${W} \${H}\`} style={{ overflow: 'visible' }}>
          <defs>
            <radialGradient id="sea" cx="50%" cy="20%" r="80%">
              <stop offset="0" stopColor={kit.color.answer} stopOpacity={0.35} />
              <stop offset="1" stopColor={kit.color.field} stopOpacity={0.9} />
            </radialGradient>
            <clipPath id="seen"><path d={seen} /></clipPath>
          </defs>
          <circle cx={CX} cy={TOP_Y + r} r={r} fill="url(#sea)" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={\`M \${W * (0.18 + 0.17 * i) + ((frame * 0.6 + i * 40) % 60)} \${TOP_Y + 90 + i * 70} h 70\`} stroke={kit.color.dim} strokeWidth={4} strokeLinecap="round" opacity={0.5 * shimmer} />
          ))}
          <path d={arc(r, half)} fill="none" stroke={kit.color.signal} strokeWidth={8} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={draw} />
          <Person r={r} a={personA} />
          {frame >= b(2).from && (
            <>
              <path d={\`M \${ex} \${ey} L \${far[0]} \${far[1]}\`} stroke={kit.color.dim} strokeWidth={3} strokeDasharray="10 12" opacity={0.9 * (1 - lineIn)} />
              <g opacity={0.25}><Ship r={r} a={shipA} /></g>
              <g clipPath="url(#seen)"><Ship r={r} a={shipA} /></g>
            </>
          )}
        </svg>
      </Mark>
      <Headline y={box.y + 40} items={[
        { text: 'The sea looks flat', at: kit.at(0, 0.2) },
        { text: 'Zoom out: it curves', at: b(1).from },
        { text: 'Hull first, mast last', at: b(2).from },
      ]} />
    </Stage>
  );
};`;
