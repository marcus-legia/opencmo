import type { ReactNode } from "react";

export type ChipTone = "running" | "waiting" | "stuck" | "posted" | "scheduled" | "idle";

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`v2-chip is-${tone}`}>{children}</span>;
}
