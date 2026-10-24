// Kinetic type: rows of tight display type snap in and hand over inside masked row windows. After Opus's MIT
// pf-type-snap remake (opus-pro/opusclip-video-tools, Copyright (c) 2026 OpusClip): capped overshoot, a streak
// whose length is fixed in pixels, a feathered seam so the two phrases never sit on top of each other.
const { Text, Streak, fx } = kit;
const { useCurrentFrame } = R;

const BG = '#141617';
const INK = '#EEF0EA';
const MUTED = '#8D938F';
const ACCENT = '#C9EF8A';
const RULE = 'rgba(238, 240, 234, 0.14)';

const W = kit.width;
const H = kit.height;
const M = Math.round(W * 0.078); // margin
const SIZE = Math.round(W * 0.163);
const ROW = Math.round(SIZE * 1.08);
const SET_A = [{ text: 'CUT' }, { text: 'BY' }, { text: 'WORDS.', accent: true }];
const SET_B = [{ text: 'SHIP' }, { text: 'EVERY' }, { text: 'WEEK.', accent: true }];
const TOP = Math.round((H - ROW * SET_A.length) / 2);
const WEIGHT = 800;
const TRACK = -0.045;

const ENTER = { at: kit.beat(0).from, each: 3, dur: 22, distance: W * 1.3, overshoot: 24 };
const SWAP = { at: kit.beat(2).from, each: 2, dur: 21, distance: W * 1.13 };
const width = (text) => kit.measure(text, { size: SIZE, font: 'display', weight: WEIGHT, tracking: TRACK });
const swapU = (row, f) => Math.min(1, Math.max(0, (f - SWAP.at - row * SWAP.each) / SWAP.dur));
const swapEase = (u) => kit.snap(u, { overshoot: 14 / SWAP.distance, curve: kit.curves.smooth });
const aOffset = (row, f) =>
  f < SWAP.at + row * SWAP.each ? kit.travel((f - ENTER.at - row * ENTER.each) / ENTER.dur, ENTER.distance, { overshoot: ENTER.overshoot }) : -SWAP.distance * swapEase(swapU(row, f));
const bOffset = (row, f) => SWAP.distance * (1 - swapEase(swapU(row, f)));

// Feathered seam: the outgoing word fades out just left of it, the incoming fades in just right of it.
const GAP = 3;
const FEATHER = 26;
const outMask = (seam) => `linear-gradient(90deg, #000 0px, #000 ${seam - GAP - FEATHER}px, transparent ${seam - GAP}px)`;
const inMask = (seam) => `linear-gradient(90deg, transparent 0px, transparent ${seam + GAP}px, #000 ${seam + GAP + FEATHER}px)`;

function Word({ word, row, offset, speed, mask, set }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: ROW, WebkitMaskImage: mask, maskImage: mask }}>
      <div style={{ position: 'absolute', left: M, top: 0, transform: `translateX(${offset}px)` }}>
        <Streak speed={speed} size={width(word.text)} origin="0% 50%">
          <Text name={`${set} ${row + 1}`} text={word.text} x={0} y={Math.round((ROW - SIZE * 1.02) / 2)} size={SIZE} weight={WEIGHT} tracking={TRACK} lineHeight={1.02} color={word.accent ? ACCENT : INK} />
        </Streak>
      </div>
    </div>
  );
}

return function Scene() {
  const f = useCurrentFrame();
  // A slow push on the type all the way through: the frame never sits dead, even while the rows rest.
  const push = kit.tween(f, [0, kit.frames], [1, 1.045], 'linear');
  return (
    <>
      <fx.Fill color={BG} />
      <fx.Vignette strength={0.5} />
      {/* Fixed chrome: kicker, rules, footer */}
      <div style={{ position: 'absolute', left: M, top: H * 0.09, width: 16, height: 16, borderRadius: 8, background: ACCENT, transform: 'translateY(10px)' }} />
      <Text text="OPENCMO EDITOR" x={M + 32} y={H * 0.09} size={38} weight={700} tracking={0.18} color={INK} />
      <div style={{ position: 'absolute', left: M, top: H * 0.09 + 72, width: W - 2 * M, height: 1.5, background: RULE }} />
      <div style={{ position: 'absolute', left: M, top: H * 0.78 - 24, width: W - 2 * M, height: 1.5, background: RULE }} />
      <Text text="UPLOAD · CUT · SHIP" x={M} y={H * 0.78} size={38} weight={600} tracking={0.12} color={MUTED} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: `${M}px 50%` }}>
      {[0, 1, 2, 3].map((k) => (
        <div key={k} style={{ position: 'absolute', left: 0, top: TOP + k * ROW, width: W, height: 1, background: 'rgba(238, 240, 234, 0.05)' }} />
      ))}
      <div style={{ position: 'absolute', left: 0, top: TOP, width: W, height: ROW * 3, overflow: 'hidden' }}>
        {SET_A.map((a, row) => {
          const b = SET_B[row];
          const aOff = aOffset(row, f);
          const bOff = bOffset(row, f);
          const swapping = f >= SWAP.at + row * SWAP.each;
          const settled = swapU(row, f) >= 1;
          const outRight = M + aOff + width(a.text);
          const seam = (outRight + M + bOff) / 2;
          const showA = !settled && outRight > 0;
          return (
            <div key={row} style={{ position: 'absolute', left: 0, top: row * ROW, width: W, height: ROW, overflow: 'hidden' }}>
              {showA ? <Word word={a} row={row} set="A" offset={aOff} speed={aOff - aOffset(row, f - 1)} mask={swapping ? outMask(seam) : undefined} /> : null}
              {swapping ? <Word word={b} row={row} set="B" offset={bOff} speed={bOff - bOffset(row, f - 1)} mask={settled || !showA ? undefined : inMask(seam)} /> : null}
            </div>
          );
        })}
      </div>
      </div>
      <fx.Grain opacity={0.06} />
    </>
  );
};
