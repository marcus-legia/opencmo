// Logo bloom: the mark grows out of a seed, turning a quarter turn and pulling focus as it lands, with motion blur
// from its own speed; the wordmark settles in under it. Ported from opus-pro/opusclip-video-tools
// remakes/opus-5.5/study-brand-bloom (MIT, Copyright (c) 2026 OpusClip): same curves, frame timings, shutter and
// focus pull; the eight-petal mark is drawn in SVG (the remake rasterises it on a canvas), scaled from 540 p to
// 1080 p, and the user's own logo can replace it.
const SLOTS = {
  logo: null, // an image name from kit.images (a square logo, ideally transparent), or null for the drawn mark
  wordmark: 'forma', // the name under the mark; '' for the mark alone
  background: '#FAF8FA',
  ink: '#28232C',
};

const { Mark, Text, Image, fx } = kit;
const { useCurrentFrame, Easing, interpolate } = R;
const W = kit.width;
const H = kit.height;
const K = H / 540; // the remake is drawn at 540 p
const D = 130 * K; // the mark's diameter
const CW = 30 * K; // capsule width
const CX = W / 2;
const CY = H / 2 - (SLOTS.wordmark ? 34 * K : 0);

// Frames at 30 fps, the remake's numbers.
const SCALE_END = 19;
const ROTATE_END = 21;
const BLUR_FROM = 7 * K;
const BLUR_END = 15;
const E = Easing.bezier(0.25, 0.4, 0.05, 1); // a brisk bloom: quick out of the seed, long soft landing, no overshoot
const FOCUS = Easing.bezier(0.33, 0, 0.3, 1); // stays soft through the fastest part, then resolves
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const poseAt = (t) => ({
  scale: t >= SCALE_END ? 1 : interpolate(t, [0, SCALE_END], [0.12, 1], { ...clamp, easing: E }),
  rotation: t >= ROTATE_END ? 0 : interpolate(t, [0, ROTATE_END], [-95, 0], { ...clamp, easing: E }),
});

// The union of four capsules at 0/45/90/135 degrees: eight round lobes and a filled middle, the top lobe up.
function Petals() {
  return (
    <svg width={D} height={D} viewBox="0 0 130 130" style={{ display: 'block', overflow: 'visible' }}>
      {[0, 45, 90, 135].map((angle) => (
        <rect key={angle} x={0} y={50} width={130} height={30} rx={15} ry={15} fill={SLOTS.ink} transform={`rotate(${angle} 65 65)`} />
      ))}
    </svg>
  );
}

function Symbol({ t }) {
  const { scale, rotation } = poseAt(t);
  return (
    <div style={{ position: 'absolute', left: CX - D / 2, top: CY - D / 2, width: D, height: D, transform: `rotate(${rotation}deg) scale(${scale})` }}>
      {SLOTS.logo ? <Image name={SLOTS.logo} x={0} y={0} w={D} h={D} fit="contain" /> : <Petals />}
    </div>
  );
}

return function Scene() {
  const frame = useCurrentFrame();
  const blur = interpolate(frame, [0, BLUR_END], [BLUR_FROM, 0], { ...clamp, easing: FOCUS });
  const word = interpolate(frame, [14, 30], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0.7, 0.2, 1) });
  return (
    <>
      <fx.Fill color={SLOTS.background} />
      <Mark name="logo" x={CX - D / 2} y={CY - D / 2} w={D} h={D}>
        <div style={{ position: 'absolute', left: -(CX - D / 2), top: -(CY - D / 2), width: W, height: H, filter: blur > 0.01 ? `blur(${blur.toFixed(3)}px)` : undefined }}>
          {/* 180-degree shutter while it moves; the hold from frame 22 is one exact, crisp sample. */}
          {frame > 0 && frame < 22 ? <fx.MotionBlur samples={16} shutter={180}>{(t) => <Symbol t={t} />}</fx.MotionBlur> : <Symbol t={frame} />}
        </div>
      </Mark>
      {SLOTS.wordmark ? (
        <div style={{ position: 'absolute', inset: 0, opacity: word, transform: `translateY(${(1 - word) * 10 * K}px)` }}>
          <Text text={SLOTS.wordmark} x={CX} y={CY + D / 2 + 28 * K} size={40 * K} align="center" font="Inter" weight={600} tracking={-0.02} color={SLOTS.ink} name="Wordmark" />
        </div>
      ) : null}
    </>
  );
};
