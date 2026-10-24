const { Stage, Headline, Image, Group, Icon, Box, Label, Mono, Arrow, Check, Burst } = kit;
const b = kit.beat;
const W = kit.width;
const S = kit.fps;
// One strip stands for the long upload from beat 2 to beat 4: x 260-1660, y 600-750.
const strip = { x: 260, y: 600, w: 1400, h: 150 };
const stripY = strip.y + strip.h / 2;
const words = [['So', true], ['um,', true], ['one', false], ['long', false], ['video', false], ['uh', true], ['becomes', false], ['a', false], ['week', false]];
const wordX = (i) => strip.x + 90 + i * 152;
const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 150 + i * 240, y: 430, w: 200, h: 240 }));
const shrink = kit.at(0, 0.62);

return function Scene() {
  return (
    <Stage ambient>
      <Headline
        items={[
          { text: 'One video, one week', at: kit.at(0, 0.05) },
          { text: 'Upload your video', at: b(1).from },
          { text: 'Cut by words', at: b(2).from },
          { text: 'B-roll on the right words', at: b(3).from },
          { text: 'A week of clips', at: b(4).from, color: 'answer' },
        ]}
      />

      {/* Beat 1: the real product is the hero, then it makes room for the week of clips. */}
      <Group x={960} y={565} keys={[{ at: shrink, x: -470, y: 20, scale: 0.5, dur: Math.round(0.8 * S) }]} at={0} exitAt={b(1).from}>
        <Image name="landing" x={400} y={250} w={1120} h={630} radius={18} at={Math.round(0.2 * S)} dur={Math.round(0.6 * S)} style={{ boxShadow: '0 24px 60px rgba(40, 32, 20, 0.22)' }} />
      </Group>
      <Arrow from={[800, 585]} to={[1010, 585]} color="dim" width={6} at={shrink + Math.round(0.6 * S)} exitAt={b(1).from} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Icon key={i} name="clapperboard" x={1140 + (i % 4) * 170} y={490 + Math.floor(i / 4) * 190} size={130} color="answer" at={shrink + Math.round(0.8 * S) + i * 4} exitAt={b(1).from} />
      ))}

      {/* Beats 2-4: the long video as one strip. */}
      <Box x={strip.x} y={strip.y} w={strip.w} h={strip.h} color="signal" dashed={false} at={b(1).from + Math.round(0.3 * S)} exitAt={b(4).from} />
      {/* The strip reads as footage: frames of the real screen, faded so the words stay readable on top. */}
      {/* They step aside while the words are on the strip (beat 3), and come back for the B-roll. */}
      {[[b(1).from + Math.round(0.45 * S), b(2).from], [b(3).from, b(4).from]].map(([from, to], set) =>
        [0, 1, 2, 3, 4, 5].map((i) => (
          <Image key={`f${set}-${i}`} name="landing" x={strip.x + 14 + i * 230} y={strip.y + 14} w={222} h={strip.h - 28} radius={8} at={from + i * 3} exitAt={to} style={{ opacity: 0.35 }} />
        )),
      )}
      <Icon name="cloud-upload" x={W / 2} y={360} size={220} color="signal" at={b(1).from + 3} exitAt={b(2).from} />
      <Arrow from={[W / 2, 480]} to={[W / 2, strip.y - 14]} color="signal" width={7} at={kit.at(1, 0.3)} exitAt={b(2).from} />
      <Mono text="transcribing…" x={W / 2} y={strip.y + strip.h + 60} size={44} color="dim" type at={kit.at(1, 0.55)} exitAt={b(2).from} />

      {/* Beat 3: the words on the strip; the filler is struck and the scissors cut. */}
      {words.map(([text, filler], i) => (
        <Label key={i} text={text} x={wordX(i)} y={stripY} size={48} color={filler ? 'dim' : 'text'} at={b(2).from + 4 + i * 3} strikeAt={filler ? kit.at(2, 0.45) + i * 2 : undefined} exitAt={b(3).from} />
      ))}
      <Icon name="scissors" x={W / 2} y={380} size={200} color="wrong" at={kit.at(2, 0.4)} exitAt={b(3).from} />

      {/* Beat 4: shots drop onto the words they belong to. */}
      {[560, 960, 1360].map((x, i) => (
        <Group key={x} x={x} y={380} keys={[{ at: kit.at(3, 0.2) + i * 6, y: 0, dur: 14 }]} at={kit.at(3, 0.2) + i * 6} exitAt={b(4).from}>
          <Icon name="image" x={x} y={380} size={170} color="answer" at={kit.at(3, 0.2) + i * 6} />
          <Arrow from={[x, 480]} to={[x, strip.y - 14]} color="answer" width={6} at={kit.at(3, 0.35) + i * 6} />
        </Group>
      ))}
      <Burst x={960} y={stripY} at={kit.at(3, 0.55)} color="answer" size={300} />

      {/* Beat 5: seven days fill with clips; the week is done. */}
      {days.map((day, i) => (
        <Box key={i} x={day.x} y={day.y} w={day.w} h={day.h} color="dim" at={b(4).from + 3 + i * 3} />
      ))}
      {days.map((day, i) => (
        <Icon key={`c${i}`} name="clapperboard" x={day.x + day.w / 2} y={day.y + day.h / 2} size={110} color="answer" at={kit.at(4, 0.2) + i * 5} />
      ))}
      <Check x={W / 2} y={790} size={130} at={kit.at(4, 0.7)} />
    </Stage>
  );
};
