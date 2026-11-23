"use client";

import { useState } from "react";

import { useWorkspace } from "@/components/today/workspace";

import { Panel } from "../parts";
import { hasLogo, PlatformBadge } from "@/components/today/platform-logos";

/** Where a founder's link can sit: their profile and their posts on each place they reply or post (wave 3 §7). */
export const TRACKING_SOURCES = [
  { src: "reddit", label: "Reddit" },
  { src: "hn", label: "Hacker News" },
  { src: "x", label: "X" },
  { src: "linkedin", label: "LinkedIn" },
  { src: "threads", label: "Threads" },
  { src: "facebook", label: "Facebook groups" },
] as const;

/** The founder's site with `?ref=ferreto&src=<place>`, keeping any path or query it already has. */
export function trackingLink(site: string, src: string): string | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
  } catch {
    return null;
  }
  url.searchParams.set("ref", "ferreto");
  url.searchParams.set("src", src);
  return url.toString();
}

/**
 * Settings › Tracking (wave 3, C8): one link per place for the founder's profile and posts, so their own analytics can
 * say which conversations sent people. Ferreto adds no script to their site in wave 3: "Signed up" counts what the
 * founder marks in Sales › Following up.
 */
export function TrackingPanel() {
  const ws = useWorkspace();
  const [copied, setCopied] = useState<string | null>(null);
  const site = ws.site;

  async function copy(src: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(src);
      setTimeout(() => setCopied((c) => (c === src ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Panel id="settings-tracking" title="Tracking">
      <div className="v2-panel-body scr-form" data-testid="settings-tracking">
        <p className="scr-small scr-muted" style={{ margin: "0" }}>
          One link per place, for your profile and posts.
        </p>
        {site ? (
          <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
            {TRACKING_SOURCES.map(({ src, label }) => {
              const link = trackingLink(site, src);
              if (!link) return null;
              return (
                <li key={src} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }} data-testid="tracking-link">
                  {hasLogo(src) ? <PlatformBadge platform={src} size={28} label={label} /> : <span style={{ width: "120px", flex: "0 0 auto" }}>{label}</span>}
                  <code style={{ flex: "1 1 240px", minWidth: "0", overflowWrap: "anywhere", fontSize: "12.5px" }}>{link}</code>
                  <button type="button" className="ib" onClick={() => void copy(src, link)} aria-label={`Copy the ${label} link`} title={copied === src ? "Copied" : "Copy"} style={copied === src ? { color: "var(--ok)", borderColor: "var(--ok)" } : undefined}>
                    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                      {copied === src ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
                    </svg>
                    <span className="sr-only">{copied === src ? "Copied" : "Copy"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="scr-small scr-muted" style={{ margin: "0" }}>
            Add your website in Your business to get your links.
          </p>
        )}
      </div>
    </Panel>
  );
}
