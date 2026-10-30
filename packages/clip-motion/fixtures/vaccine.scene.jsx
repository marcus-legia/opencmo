const { Stage, Headline, Board, Icon, Shape, Arrow, Group, Burst, Check } = kit;
const b = kit.beat;
const W = kit.width;
const H = kit.height;
const full = kit.area('full');
const mid = full.y + full.h * 0.56;
const left = W * 0.27;
const right = W * 0.73;
const split = kit.at(1, 0.45);
const fragments = [[W * 0.4, mid - 150], [W * 0.52, mid + 120], [W * 0.64, mid - 90]];
const impact = kit.at(3, 0.55);
const steps = kit.area('left');

return function Scene() {
  return (
    <Stage ambient>
      <Headline
        items={[
          { text: 'Training, not fighting', at: 0 },
          { text: 'A harmless piece', at: b(1).from },
          { text: 'Antibodies that fit', at: b(2).from },
          { text: 'Ready for the real virus', at: b(3).from },
          { text: 'Three steps', at: b(4).from },
          { text: 'Protected', at: b(5).from, color: 'answer' },
        ]}
      />

      {/* Beat 1: the vaccine trains the body before the virus arrives. */}
      <Icon name="syringe" x={left} y={mid} size={380} color="signal" at={kit.at(0, 0.1)} exitAt={b(1).from} />
      <Arrow from={[left + 230, mid]} to={[right - 230, mid]} color="dim" width={7} curve={-0.12} at={kit.at(0, 0.4)} exitAt={b(1).from} />
      <Icon name="shield-check" x={right} y={mid} size={380} color="answer" at={kit.cue(0, 'immune')} exitAt={b(1).from} />

      {/* Beat 2: only a harmless piece of the virus. */}
      <Icon name="virus" x={W / 2} y={mid} size={420} color="wrong" at={b(1).from + 4} exitAt={split + 4} />
      <Burst x={W / 2} y={mid} at={split} color="wrong" size={320} />
      {fragments.map(([x, y], i) => (
        <Icon key={i} name="virus" x={x} y={y} size={170} color="noise" at={split + 2 + i * 4} exitAt={b(3).from} />
      ))}

      {/* Beat 3: immune cells study the piece and build antibodies that fit it. */}
      <Shape kind="cell" x={W * 0.19} y={mid} size={320} color="answer" label="Immune cell" secondary at={b(2).from} exitAt={b(3).from} />
      <Arrow from={[W * 0.28, mid - 40]} to={[fragments[0][0] - 100, fragments[0][1] + 20]} width={7} color="answer" at={kit.at(2, 0.25)} exitAt={b(3).from} />
      <Icon name="dna" x={W * 0.82} y={mid} size={260} color="accent2" at={kit.cue(2, 'antibodies')} exitAt={b(3).from} />
      <Shape kind="ring" x={W * 0.82} y={mid} size={380} color="accent2" at={kit.cue(2, 'antibodies') + 6} exitAt={b(3).from} />

      {/* Beat 4: the real virus arrives and is stopped at once. */}
      <Group x={W * 0.25} y={mid} keys={[{ at: b(3).from + 6, x: W * 0.17 }]} react={{ at: impact, from: [right, mid], strength: 70 }} at={b(3).from} exitAt={b(4).from}>
        <Icon name="virus" x={W * 0.2} y={mid} size={300} color="wrong" at={b(3).from} />
      </Group>
      <Icon name="shield-check" x={right} y={mid} size={420} color="answer" at={b(3).from + 2} exitAt={b(4).from} />
      <Burst x={right - 210} y={mid} at={impact} color="answer" size={280} />

      {/* Beat 5: the three steps. */}
      <Board
        kind="steps"
        area={steps}
        lines={['Show a harmless piece', 'Build matching antibodies', 'Remember them for years']}
        lineAt={[kit.cue(4, 'show'), kit.cue(4, 'build'), kit.cue(4, 'remember')]}
        at={b(4).from}
        exitAt={b(5).from}
      />
      <Icon name="syringe" x={right} y={mid} size={360} color="signal" at={b(4).from + 8} exitAt={b(5).from} />

      {/* Beat 6: protected. */}
      <Check x={W / 2} y={mid} size={340} at={b(5).from + 6} />
      <Burst x={W / 2} y={mid - 40} at={b(5).from + 18} color="answer" size={520} />
    </Stage>
  );
};
