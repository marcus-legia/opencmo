import type { ReactNode } from "react";

import type { ApprovalCard as Card, CardKind } from "@/lib/screens/approval-card";
import { PLATFORM_LABEL } from "@/lib/screens/common";

/** A post's tile by platform: X's mark for X, LinkedIn's for LinkedIn, a generic post mark otherwise. */
export const PLATFORM_ICON: Record<string, ReactNode> = {
  linkedin: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  ),
  threads: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
};

/** The artboards' row tiles (Main.dc.html), by card kind. */
export const KIND_ICON: Record<CardKind, ReactNode> = {
  post: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 3h3l-6.6 7.5L21.6 21h-6l-4.7-6.1L5.5 21h-3l7.1-8.1L2.4 3h6.1l4.2 5.6z" />
    </svg>
  ),
  reply: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
  goal: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  script: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  ),
  price: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  ),
  finished_video: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  ),
  shorts_batch: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  ),
  slideshow: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  ),
  schedule: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  ),
  correction: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  ),
  plan: (
    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  ),
};

const where = (card: Card) => (card.account ? PLATFORM_LABEL[card.account.platform] : null);

/** The grey kind before the title: "X post", "Script · you record", "Reddit · r/SaaS". */
export function kindLabel(card: Card): string {
  const platform = where(card);
  switch (card.kind) {
    case "post":
      return `${platform ?? "Post"}${platform ? " post" : ""}`;
    case "reply":
      return card.body.kind === "reply" ? `Reddit · ${card.body.community}` : "Reddit reply";
    case "script":
      return "Script · you record";
    case "price":
      return "Video";
    case "finished_video":
      return "Finished video";
    case "shorts_batch":
      return "Shorts";
    case "slideshow":
      return "Slideshow";
    case "schedule":
      return platform ? `${platform} · time` : "Time";
    case "correction":
      return "Correction";
    case "plan":
      return "Week plan";
    case "goal":
      return "Goal";
  }
}

const at = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: false });

/** The short meta on the right of a row: when it goes out, or what it costs. */
export function whenLabel(card: Card): string | null {
  if (card.postAt) return at.format(new Date(card.postAt)).replace(",", "");
  if (card.priceCredits) return `${card.priceCredits} credits`;
  return null;
}
