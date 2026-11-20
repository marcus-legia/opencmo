/**
 * Quote card (wave 4b B5), against a golden image:
 *
 *     cd apps/web && npx tsx lib/og/quote-card.check.tsx            # compare
 *     cd apps/web && npx tsx lib/og/quote-card.check.tsx --update   # write the golden after a wanted change; look at it
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { PLAIN_COLORS, QUOTE_CARD_SIZE, isSerifFont, quoteCardImage, quoteFontSize, safeColor } from "./quote-card";

const GOLDEN = path.join(process.cwd(), "assets/golden/quote-card.png");
const failures: string[] = [];
async function check(label: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
await check("serif heading fonts draw in the serif face", () => {
  for (const f of ["Playfair Display", "DM Serif Display", "Lora", "Merriweather"]) assert.ok(isSerifFont(f), f);
  for (const f of ["Inter", "Montserrat", "DM Sans", "Noto Sans", "PT Sans"]) assert.ok(!isSerifFont(f), f);
});
await check("a longer quote gets smaller type", () => assert.ok(quoteFontSize("x".repeat(280)) < quoteFontSize("short")));
await check("a colour Satori cannot draw falls back", () => {
  assert.equal(safeColor("#AABBCC", "#000000"), "#AABBCC");
  assert.equal(safeColor("red; background:url(x)", "#000000"), "#000000");
  assert.equal(safeColor(undefined, "#000000"), "#000000");
});

await check("the card matches its golden image", async () => {
  const image = await quoteCardImage({
    quote: "I pay $50 a month for a form builder and half my leads still never fill the thing in.",
    community: "r/SaaS",
    colors: { ...PLAIN_COLORS },
    serif: false,
    logo: null,
  });
  const png = Buffer.from(await image.arrayBuffer());
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, QUOTE_CARD_SIZE.width);
  assert.equal(meta.height, QUOTE_CARD_SIZE.height);
  if (process.argv.includes("--update")) {
    await fs.writeFile(GOLDEN, png);
    console.log(`wrote ${GOLDEN}`);
    return;
  }
  const [a, b] = await Promise.all([sharp(png).raw().toBuffer(), sharp(await fs.readFile(GOLDEN)).raw().toBuffer()]);
  assert.equal(a.length, b.length, "size differs from the golden");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i]! - b[i]!);
  const mean = diff / a.length;
  // Font hinting may move a few pixels between machines; a layout change moves thousands.
  assert.ok(mean < 0.5, `mean pixel difference ${mean.toFixed(3)} (over 0.5): look at the card, then --update`);
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("quote-card: ok");
}

void main();
