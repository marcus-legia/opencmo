/**
 * A small pixel robot drawn from a 13×12 character map: O = brand, D = ink, E = eyes.
 * Eyes are their own group so CSS can blink them; the whole sprite bobs in steps.
 */
const SPRITE = [
  "......O......",
  "......D......",
  "..OOOOOOOOO..",
  ".OOOOOOOOOOO.",
  ".OOEEOOOEEOO.",
  ".OOEEOOOEEOO.",
  ".OOOOOOOOOOO.",
  "DOOOOOOOOOOOD",
  "DOOOOOOOOOOOD",
  ".OOOOOOOOOOO.",
  "..OO.....OO..",
  "..DD.....DD..",
];

function cells(ch: string) {
  return SPRITE.flatMap((row, y) => [...row].map((c, x) => (c === ch ? <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" /> : null)));
}

export function PixelBot({ delay = 0 }: { delay?: number }) {
  return (
    <svg viewBox="0 0 13 12" aria-hidden="true" shapeRendering="crispEdges" className="lv-bot" style={{ animationDelay: `${delay}s` }}>
      <g className="lv-bot-body">{cells("O")}</g>
      <g className="lv-bot-ink">{cells("D")}</g>
      <g className="lv-bot-eyes" style={{ animationDelay: `${delay * 1.7}s` }}>{cells("E")}</g>
    </svg>
  );
}
