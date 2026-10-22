const { Stage, Headline, Box, Icon, Label, Check, Burst, Group } = kit;
const b = kit.beat;
const S = kit.fps;
const card = { x: 360, y: 240, w: 1200, h: 620 };
const rows = [
  { y: 385, icon: 'receipt', text: 'Send invoices', done: 'Invoices: automatic' },
  { y: 550, icon: 'calendar-clock', text: 'Book calls', done: 'Calls: booked for you' },
  { y: 715, icon: 'pen-line', text: 'Draft posts', done: 'Posts: drafted for you' },
];

return function Scene() {
  return (
    <Stage ambient>
      <Headline
        items={[
          { text: 'Automate these first', at: 0 },
          { text: '1. Invoices', at: b(1).from },
          { text: '2. Scheduling', at: b(2).from },
          { text: '3. Social posts', at: b(3).from },
          { text: 'Tick them off', at: b(4).from, color: 'answer' },
        ]}
      />
      <Group x={card.x + card.w / 2} y={card.y + card.h / 2} keys={[{ at: kit.at(4, 0.2), scale: 1.05, dur: Math.round(0.5 * S) }]} at={0}>
        <Box x={card.x} y={card.y} w={card.w} h={card.h} color="dim" dashed={false} at={Math.round(0.1 * S)} dur={Math.round(0.5 * S)} />
        {rows.map((row, i) => {
          const land = Math.round(0.6 * S) + i * 6;
          const beat = i + 1;
          return (
            <React.Fragment key={row.icon}>
              <Icon name={row.icon} x={480} y={row.y} size={110} color="signal" at={land} />
              <Label text={row.text} anchor="left" x={570} y={row.y} size={64} at={land + 2} swapTo={row.done} swapAt={kit.at(beat, 0.45)} />
              <Check x={1450} y={row.y} size={100} at={kit.at(beat, 0.3)} />
              <Burst x={1450} y={row.y} at={kit.at(beat, 0.3) + 4} color="answer" size={180} />
            </React.Fragment>
          );
        })}
      </Group>
    </Stage>
  );
};
