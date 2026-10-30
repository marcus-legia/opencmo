/**
 * The fallback when a post cannot go through Zernio (P4 F9): no account connected for that platform, or
 * Zernio is down. The founder posts it themselves: X and Threads open their composer with the text in it;
 * LinkedIn's share page takes no text, so the post is copied first, then opened.
 *
 * Pure module: client cards import it. TikTok, YouTube and Instagram have no web composer that takes a
 * video, so they have no fallback here; their card asks the founder to connect the account.
 */

import type { PublishPlatform } from "./types";

export type IntentTarget = {
  /** The page to open, with the text in it when the platform takes it. */
  url: string;
  /** True when the text must be copied before opening (the page does not take it). */
  copy: boolean;
  /** The button: "Open X", "Copy and open LinkedIn". */
  label: string;
};

export function xIntent(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function threadsIntent(text: string): string {
  return `https://www.threads.com/intent/post?text=${encodeURIComponent(text)}`;
}

export const LINKEDIN_SHARE = "https://www.linkedin.com/feed/?shareActive=true";

/** The fallback for one platform, or null when the platform has none. */
export function intentFor(platform: PublishPlatform, text: string): IntentTarget | null {
  switch (platform) {
    case "x":
      return { url: xIntent(text), copy: false, label: "Open X" };
    case "threads":
      return { url: threadsIntent(text), copy: false, label: "Open Threads" };
    case "linkedin":
      return { url: LINKEDIN_SHARE, copy: true, label: "Copy and open LinkedIn" };
    default:
      return null;
  }
}
