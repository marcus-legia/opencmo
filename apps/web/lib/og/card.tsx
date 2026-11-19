import fs from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

/**
 * Ảnh chia sẻ 1200×630 cho landing và từng bài, theo token của landing (`styles/landing.css`):
 * nền `--paper`, chữ `--ink`, cam `--brand`, font Inter như trang.
 *
 * Satori không đọc woff2, và đọc font BIẾN THIÊN (variable) thì vỡ
 * (`Cannot read properties of undefined (reading '257')`), nên `assets/fonts/inter.ttf` là bản TTF TĨNH (Inter 600,
 * OFL). Con chồn là `assets/og-logo.png`, ảnh tĩnh render từ `public/logo.svg` (Satori không chạy CSS của SVG);
 * đổi logo thì render lại file này.
 * Ảnh dựng lúc build (route tĩnh), không tốn compute khi bot lấy ảnh.
 */
export const OG_SIZE = { width: 1200, height: 630 };

const PAPER = "#f3f3ee";
const INK = "#2b2723";
const INK2 = "#69695d";
const BRAND = "#ef4a1a";
const LINE = "#d6d6c9";

async function assets() {
  const dir = path.join(process.cwd(), "assets");
  const [inter, logo] = await Promise.all([
    fs.readFile(path.join(dir, "fonts/inter.ttf")),
    fs.readFile(path.join(dir, "og-logo.png")),
  ]);
  return {
    fonts: [{ name: "Inter", data: inter, weight: 600 as const, style: "normal" as const }],
    logo: `data:image/png;base64,${logo.toString("base64")}`,
  };
}

export async function ogCard({ kicker, title, footer }: { kicker: string; title: string; footer: string }) {
  const size = title.length > 60 ? 54 : title.length > 40 ? 62 : 72;
  const { fonts, logo } = await assets();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: PAPER, fontFamily: "Inter", color: INK, padding: "64px 72px 56px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, color: BRAND, fontSize: 22, letterSpacing: 3, textTransform: "uppercase" }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: BRAND }} />
          {kicker}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
          <div style={{ display: "flex", width: 600, fontSize: size, lineHeight: 1.06, letterSpacing: -2 }}>{title}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> only. */}
          <img src={logo} width={440} height={246} alt="" />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 24, fontSize: 24, color: INK2 }}>
          <span style={{ fontSize: 32, color: INK, letterSpacing: -1 }}>Ferreto</span>
          <span>{footer}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
