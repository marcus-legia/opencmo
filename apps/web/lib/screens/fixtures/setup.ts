import type { SetupScreen } from "../setup";
import { at } from "./shared";

/** `Setup.dc.html`, step 2 of 5. */
export const setupFixture: SetupScreen = {
  site: "ferreto.io",
  step: "documents",
  done: ["website"],
  documents: [
    { kind: "product", title: "Product Information", note: "9 fields", updatedAt: at("2026-10-29", "10:30") },
    { kind: "strategy", title: "Marketing Strategy", note: "drafted", updatedAt: at("2026-10-29", "10:30") },
    { kind: "competitors", title: "Competitor Analysis", note: "4 found", updatedAt: at("2026-10-29", "10:30") },
    { kind: "post_plan", title: "Post plan", note: "drafted", updatedAt: at("2026-10-29", "10:30") },
    { kind: "brand", title: "Brand", note: "drafted", updatedAt: at("2026-10-29", "10:30") },
  ],
  accounts: [],
  hasBrandKit: false,
  goal: null,
};

export const setupEmpty: SetupScreen = {
  site: null,
  step: "website",
  done: [],
  documents: [],
  accounts: [],
  hasBrandKit: false,
  goal: null,
};
