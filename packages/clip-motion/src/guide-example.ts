/**
 * The explainer guide's example scene (read_guide "explainer"): a subject drawn in scene code inside kit.Mark, with
 * its own curves, instead of icons. Rendered in golden.test.ts so the example the model copies always compiles and
 * passes the layout report.
 */

export const EXPLAINER_EXAMPLE_BEATS: { say: string; label: string; visual: string }[] = [
	{
		say: 'Stand on a beach and the sea looks perfectly flat, right to the horizon.',
		label: 'The sea looks flat',
		visual: 'a wide sea band; a gold horizon line draws across it from the left',
	},
	{
		say: 'Pull back far enough, and that straight line bends into the edge of a huge circle.',
		label: 'Zoom out: it curves',
		visual: 'the horizon line bends into an arc as the sea shrinks into the top of a sphere',
	},
	{
		say: 'That is why a ship sailing away disappears hull first, mast last.',
		label: 'Hull first, mast last',
		visual: 'a ship sails right along the arc and sinks below it hull-first, the mast tip last',
	},
];

export const EXPLAINER_EXAMPLE = `const { Stage, Headline, Mark } = kit;
const { useCurrentFrame, interpolate, Easing } = R;
const b = kit.beat;
const hero = kit.area('hero');
const W = hero.w;
const H = hero.h;
// A move with a small, capped overshoot (about 3% of the travel), then a settle.
const settle = Easing.bezier(0.34, 1.2, 0.64, 1);
const smooth = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
// The horizon as a quadratic curve whose middle rises by sag px: 0 = straight, H * 0.35 = the top of a sphere.
const horizon = (sag) => \`M 0 \${H * 0.55} Q \${W / 2} \${H * 0.55 - 2 * sag} \${W} \${H * 0.55}\`;

return function Scene() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [kit.at(0, 0.1), kit.at(0, 0.6)], [1, 0], { ...clamp, easing: smooth });
  const sag = interpolate(frame, [b(1).from + 6, kit.at(1, 0.7)], [0, H * 0.35], { ...clamp, easing: settle });
  const sail = interpolate(frame, [b(2).from, kit.at(2, 0.85)], [0, 1], { ...clamp, easing: smooth });
  // The ship rides the curve: x moves right, y follows the arc, then it sinks below the line as it passes the crest.
  const shipX = W * (0.3 + 0.55 * sail);
  const u = shipX / W;
  const arcY = H * 0.55 - 2 * sag * 2 * u * (1 - u);
  const sink = interpolate(sail, [0.45, 1], [0, 150], clamp);
  return (
    <Stage ambient>
      <Mark name="sea" x={hero.x} y={hero.y} w={W} h={H} at={b(0).from}>
        <svg width={W} height={H} viewBox={\`0 0 \${W} \${H}\`} style={{ overflow: 'visible' }}>
          <defs>
            <clipPath id="above"><path d={\`\${horizon(sag)} L \${W} 0 L 0 0 Z\`} /></clipPath>
          </defs>
          <path d={\`\${horizon(sag)} L \${W} \${H} L 0 \${H} Z\`} fill={kit.color.signal} opacity={0.12} />
          <path d={horizon(sag)} fill="none" stroke={kit.color.signal} strokeWidth={8} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={draw} />
          {frame >= b(2).from && (
            <g clipPath="url(#above)">
              <g transform={\`translate(\${shipX} \${arcY + sink})\`} opacity={interpolate(frame, [b(2).from, b(2).from + 8], [0, 1], clamp)}>
                <path d="M -70 -10 L 70 -10 L 48 22 L -48 22 Z" fill={kit.color.answer} />
                <path d="M 0 -10 L 0 -130" stroke={kit.color.text} strokeWidth={6} />
                <path d="M 4 -122 L 60 -40 L 4 -40 Z" fill={kit.color.text} />
              </g>
            </g>
          )}
        </svg>
      </Mark>
      <Headline y={kit.area('full').y + 40} items={[
        { text: 'The sea looks flat', at: kit.at(0, 0.2) },
        { text: 'Zoom out: it curves', at: b(1).from },
        { text: 'Hull first, mast last', at: b(2).from },
      ]} />
    </Stage>
  );
};`;
