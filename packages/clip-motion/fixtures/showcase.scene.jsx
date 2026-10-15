const { Stage, Camera, Title, Label, Mono, Waveform, Spectrogram, DotField, Link, Axes, Scatter, FitLine, Check } = kit;
const b = kit.beat;
const full = kit.area('full');
// The visual lives under the headline row; narrower than the safe area so the camera push stays inside it.
const stage = { x: full.x + full.w * 0.05, y: full.y + full.h * 0.2, w: full.w * 0.9, h: full.h * 0.76 };
const headline = full.y + full.h * 0.07;
const spec = kit.spectrogram(7, { cols: 44, rows: 20, peaks: 15 });
const peak = (i) => kit.place(stage, [spec.peaks[i].x, spec.peaks[i].y]);
const pairs = [];
for (let i = 0; i + 2 < spec.peaks.length; i += 3) pairs.push([i, i + 1], [i, i + 2]);
const matches = kit.trend(3, { n: 22, slope: 0.8, spread: 0.02 });
const noise = kit.trend(11, { n: 26, slope: 0, spread: 0.4 });
const plot = kit.area('hero');
const found = kit.plot(plot, [0.27, 0.74]);
const low = { x: stage.x, y: stage.y + stage.h * 0.4, w: stage.w, h: stage.h * 0.6 };
const top = kit.area('top');

return function Scene() {
  return (
    <Stage>
      <Camera keys={[{ at: b(2).from, zoom: 1.04, focus: [stage.x + stage.w / 2, stage.y + stage.h / 2] }, { at: b(5).from, zoom: 1 }]}>
        <Waveform area={low} at={kit.at(0, 0.3)} noise={0.9} cleanAt={kit.at(0, 0.85)} exitAt={b(1).from} exitDur={18} />
        <Spectrogram data={spec} area={stage} at={b(1).from + 6} dur={45} peaksAt={kit.cue(2, 'brightest')} constellationAt={kit.at(2, 0.7)} exitAt={b(5).from} />
        <DotField area={stage} points={spec.peaks.map((p) => ({ x: p.x, y: p.y, v: 1 }))} size={9} glow={1.3} drift={0} at={kit.at(2, 0.6)} dur={12} exitAt={b(5).from} />
        {pairs.map(([a, c], i) => (
          <Link key={i} from={peak(a)} to={peak(c)} at={kit.stagger(i, { at: b(3).from + 10, each: 4 })} curve={0.15} width={3} dots={false} exitAt={b(5).from} />
        ))}
        <Axes area={plot} x="time in song" y="time in clip" at={b(5).from + 6} />
        <Scatter area={plot} points={[...matches, ...noise]} at={b(5).from + 16} dur={40} highlight={matches.map((_, i) => i)} highlightAt={kit.cue(6, 'line')} />
        <FitLine area={plot} from={[0.05, 0.14]} to={[0.95, 0.86]} at={kit.cue(6, 'line')} />
        <Check x={found[0]} y={found[1]} size={200} at={b(7).from + 6} />
      </Camera>

      <Title text="How Shazam hears a song" kicker="In a noisy bar" y={top.cy} exitAt={kit.at(0, 0.7)} />
      <Label text="Music plus noise" y={headline} at={kit.at(0, 0.8)} exitAt={b(1).from} />
      <Label text="Time × pitch" y={headline} at={b(1).from + 10} swapTo="Brightest peaks" swapAt={b(2).from} exitAt={b(3).from} />
      <Label text="Pairs of peaks" y={headline} at={b(3).from} exitAt={b(4).from} />
      <Mono text="f1 | f2 | gap" y={headline} at={b(4).from} swapTo="523 | 784 | 0.12" swapAt={kit.at(4, 0.6)} exitAt={b(5).from} size={52} />
      <Label text="Matching codes" y={headline} at={b(5).from} swapTo="One straight line" swapAt={b(6).from} exitAt={b(7).from} />
      <Label text="Song found" y={headline} size={60} color="answer" at={b(7).from + 20} />
    </Stage>
  );
};
