"use client";

import { absoluteUrl, SUPPORT_EMAIL } from "@/lib/site";

import { BRAND, FOOTER_COLUMNS } from "./data";
import { LogoMark, SocialTile } from "./Glyphs";
import { onAnchorClick } from "./motion";

/**
 * The footer's link grid, legal row and wordmark: the landing's and, with `onLanding` off, the blog's and the legal
 * pages' (`.site`). Off the landing, in-page anchors become the landing's address, and every site link is absolute,
 * since the blog may be on its own host.
 *
 * The four legal links + support email are a Creem review requirement (rule 6): always visible while logged out.
 */
export function FooterLinks({ onLanding = false }: { onLanding?: boolean }) {
  const site = (path: string) => (onLanding ? path : absoluteUrl(path));
  return (
    <>
      <div className="lv-glass">
        <div className="lv-glass-inner">
          <div className="lv-foot-top">
            <div className="lv-foot-brand">
              <span><LogoMark size={30} /><span>{BRAND}</span></span>
              <p>Finds the people already asking for what you built. You reply as yourself.</p>
            </div>
            <p className="lv-foot-support">
              <span className="lv-mono-eyebrow">Questions or billing</span>
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </div>
          <nav aria-label="Footer" className="lv-foot-cols">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h3>{col.title}</h3>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.t}>
                      {l.href.startsWith("#") && l.href.length > 1 ? (
                        onLanding ? <a href={l.href} onClick={onAnchorClick(l.href.slice(1))}>{l.t}</a> : <a href={absoluteUrl(`/${l.href}`)}>{l.t}</a>
                      ) : (
                        <a href={l.href.startsWith("/") ? site(l.href) : l.href}>
                          {l.social && <SocialTile k={l.social} size={20} radius={6} title={false} />}
                          {l.t}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="lv-foot-bottom">
            <p>{BRAND} is independent software and is not affiliated with or endorsed by any social network it works with.</p>
            <div className="lv-foot-legal">
              <a href={site("/privacy")}>Privacy</a>
              <a href={site("/terms")}>Terms</a>
              <a href={site("/acceptable-use")}>Acceptable Use</a>
              <a href={site("/refund")}>Refunds</a>
              <a href={site("/llms.txt")}>llms.txt</a>
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="lv-wordmark">{BRAND}</div>
    </>
  );
}
