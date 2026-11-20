import React from "react";

import fs from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

/**
 * A quote card (wave 4b B5): one quote from the founder's Library on their brand look, 1080×1350 (4:5, the portrait
 * size X, Threads, LinkedIn and Facebook all show whole). The quote and its community only: no name, no title, no
 * link, so nobody is pointed at. Drawn by Satori like the OG cards (`card.tsx`): no AI, no credit.
 *
 * The brand's fonts ship as woff2, which Satori cannot read, so the card takes the brand's kind of type instead: a
 * serif heading font draws in Fraunces, any other in Inter (both static TTF in `assets/fonts`).
 */
export const QUOTE_CARD_SIZE = { width: 1080, height: 1350 };

export type QuoteCardInput = {
  quote: string;
  /** "r/saas", "Hacker News", a Facebook group's name. */
  community: string;
  colors: { background: string; text: string; accent: string };
  serif: boolean;
  /** A PNG data URL of the brand logo, or null. */
  logo: { src: string; width: number; height: number } | null;
};

const SERIF_FONTS = /serif|playfair|lora|merriweather|fraunces|garamond|georgia|times|libre baskerville|crimson|abril|dm serif/i;

/** A serif heading font in the brand kit (`fonts.heading`) draws the card in the serif face. */
export function isSerifFont(name: string): boolean {
  return SERIF_FONTS.test(name) && !/sans/i.test(name.replace(/dm serif/i, ""));
}

/** Type size by length, so a 280-character quote still fits with room around it. */
export function quoteFontSize(quote: string): number {
  const n = quote.length;
  return n <= 60 ? 84 : n <= 120 ? 68 : n <= 200 ? 56 : 48;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** A brand colour, or the fallback when the kit holds something Satori would not draw. */
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}

/** No brand kit: ink on paper, the plain look. */
export const PLAIN_COLORS = { background: "#f6f5f0", text: "#1f1d1a", accent: "#5b5a52" } as const;

async function fonts(serif: boolean) {
  const file = serif ? "fraunces.ttf" : "inter.ttf";
  const data = await fs.readFile(path.join(process.cwd(), "assets/fonts", file));
  return [{ name: "Card", data, weight: 600 as const, style: "normal" as const }];
}

export async function quoteCardImage(input: QuoteCardInput): Promise<ImageResponse> {
  const { colors } = input;
  const size = quoteFontSize(input.quote);
  const logoWidth = input.logo ? Math.min(220, Math.round((input.logo.width / input.logo.height) * 90)) : 0;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: colors.background, color: colors.text, fontFamily: "Card", padding: "110px 100px 90px" }}>
        <div style={{ display: "flex", fontSize: 200, lineHeight: 0.8, color: colors.accent, height: 120 }}>{"“"}</div>
        <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: size, lineHeight: 1.22, letterSpacing: -1 }}>{input.quote}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32, borderTop: `3px solid ${colors.accent}`, paddingTop: 36 }}>
          <div style={{ display: "flex", fontSize: 36, color: colors.accent }}>{`Said in ${input.community}`}</div>
          {input.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> only.
            <img src={input.logo.src} width={logoWidth} height={Math.round((logoWidth * input.logo.height) / input.logo.width)} alt="" />
          ) : null}
        </div>
      </div>
    ),
    { ...QUOTE_CARD_SIZE, fonts: await fonts(input.serif) },
  );
}
void React; // tsx (the check) compiles JSX classically: React must be in scope.
