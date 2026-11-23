"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { LibraryCounts } from "@/app/api/v1/library/counts/route";
import { api } from "@/components/clipping/api";
import { bare } from "@/lib/cmo/quote";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useScreen } from "@/components/screens/useScreen";
import { useShellState } from "@/components/shell-v2/ShellState";
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";
import type { LibraryEntry } from "@/lib/cmo/library";
import type { LibraryThemeView } from "@/lib/screens/library";
import { hasLogo, PlatformBadge } from "./platform-logos";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where a quote was said, as the founder would name it: "r/freelance", "Hacker News", "Facebook groups · SaaS Founders". */
export function whereSaid(entry: Pick<LibraryEntry, "platform" | "community">): string {
  const community = entry.community.trim();
  if (entry.platform === "reddit") return community ? (/^r\//i.test(community) ? community : `r/${community}`) : "Reddit";
  if (!community || community === PLATFORM_LABEL[entry.platform]) return PLATFORM_LABEL[entry.platform];
  return `${PLATFORM_LABEL[entry.platform]} · ${community}`;
}

/** What the chat box gets: the founder reads it, can change it, and sends it. */
export const themePrompt = (theme: string) => `Write a post from what people said about "${theme}" in my Library.`;

/** The Library's counts for the left panel and the filter; null until read (or when the read fails: nothing is shown). */
export function useLibraryCounts(): LibraryCounts | null {
  const [counts, setCounts] = useState<LibraryCounts | null>(null);
  const { workVersion } = useShellState();
  useEffect(() => {
    let alive = true;
    api<LibraryCounts>("/library/counts")
      .then((next) => alive && setCounts(next))
      .catch(() => {
        // The counts are a hint; without them the link and the filter show no number.
      });
    return () => {
      alive = false;
    };
  }, [workVersion]);
  return counts;
}

function ThemeCard({ theme, onWrite }: { theme: LibraryThemeView; onWrite: (name: string) => void }) {
  // Two or three quotes, one per conversation, pain first: the words people used, never a title.
  const quotes = theme.entries.flatMap((entry) => {
    const quote = entry.quotes.find((q) => q.kind === "pain") ?? entry.quotes[0];
    return quote ? [{ id: entry.opportunityId, text: quote.text, where: whereSaid(entry), platform: entry.platform }] : [];
  });
  return (
    <section className="card" data-testid="library-theme" aria-labelledby={`theme-${theme.id}`} style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <h2 id={`theme-${theme.id}`} style={{ margin: "0", fontSize: "15px", fontWeight: "600" }}>
          {theme.name}
        </h2>
        <span className="meta mono">{plural(theme.count, "conversation", "conversations")}</span>
        <span className="meta" style={{ marginLeft: "auto", color: theme.thisWeek > 0 ? "var(--ok)" : undefined }}>
          {theme.thisWeek > 0 ? `+${theme.thisWeek} this week` : "none new this week"}
        </span>
      </div>
      {quotes.length ? (
        <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
          {quotes.map((q) => (
            <li key={q.id} data-testid="library-quote" style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px", borderRadius: "11px", background: "var(--raised)", fontSize: "14px", lineHeight: "1.5" }}>
              {hasLogo(q.platform) ? <PlatformBadge platform={q.platform} size={20} /> : null}
              <span>
                “{bare(q.text)}” <span className="meta">{q.where}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {theme.entries[0] ? <p className="meta" style={{ margin: "0" }}>Latest: {theme.entries[0].summary}</p> : null}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span className="meta">{theme.usedInPosts > 0 ? `Used in ${plural(theme.usedInPosts, "post", "posts")}` : "Not used in a post yet"}</span>
        <button type="button" className="ghost" style={{ marginLeft: "auto" }} onClick={() => onWrite(theme.name)}>
          Write a post from this
        </button>
      </div>
    </section>
  );
}

/**
 * The Library (wave 3, canvas board Library): what people said in the conversations Sales kept, grouped into themes,
 * most talked about first. Post writes from here; "Write a post from this" puts a request in the CMO chat's box, which
 * the founder reads and sends (nothing is written or charged before that).
 */
export function LibraryView() {
  const params = useSearchParams();
  const raw = params.get("source");
  const source = raw && (SALES_PLATFORMS as readonly string[]).includes(raw) ? (raw as SalesPlatform) : null;
  const [state] = useScreen("library", source ? { source } : {});
  const counts = useLibraryCounts();
  const { focusChat } = useShellState();
  const themes = state.status === "ready" ? (state.data.themes ?? []) : [];

  const write = (name: string) => {
    focusChat();
    fillChat(themePrompt(name));
  };

  const tabs: { id: SalesPlatform | null; label: string; n: number | null }[] = [
    { id: null, label: "All", n: counts?.total ?? null },
    ...SALES_PLATFORMS.map((p) => ({ id: p, label: PLATFORM_LABEL[p], n: counts?.bySource[p] ?? null })),
  ];

  return (
    <div data-sec="find" style={{ maxWidth: "1180px", margin: "0 auto", padding: "22px 24px 40px" }} data-testid="v2-library">
      <div className="sec-band">
        <span className="sec-tile">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
          </svg>
        </span>
        <h1>Library</h1>
        {counts && counts.thisWeek > 0 ? <span className="sec-chip" style={{ color: "var(--ok)" }}>+{counts.thisWeek} this week</span> : null}
      </div>

      <nav aria-label="Filter by source" style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "16px 0 14px" }}>
        {tabs.map((t) => {
          const on = t.id === source;
          return (
            <Link
              key={t.id ?? "all"}
              href={t.id ? `/app/library?source=${t.id}` : "/app/library"}
              scroll={false}
              aria-current={on ? "page" : undefined}
              data-testid="library-filter"
              className="pick-btn"
              title={t.label}
              style={{ textDecoration: "none", paddingLeft: t.id ? "6px" : "12px", opacity: t.n === 0 && !on ? 0.5 : undefined, ...(on ? { background: "var(--sec)", borderColor: "var(--sec)", color: "#fff" } : {}) }}
            >
              {t.id && hasLogo(t.id) ? (
                <>
                  <PlatformBadge platform={t.id} size={24} />
                  <span className="sr-only">{t.label}</span>
                </>
              ) : (
                t.label
              )}
              {t.n !== null ? <span className="mono">{t.n}</span> : null}
            </Link>
          );
        })}
      </nav>

      {state.status === "loading" ? <p className="meta">Loading…</p> : null}
      {state.status === "error" ? <p className="meta">{state.message}</p> : null}
      {state.status === "ready" && themes.length === 0 ? (
        <div className="card" data-testid="library-empty">
          <b>{source ? `Nothing from ${PLATFORM_LABEL[source]} yet.` : "Nothing saved yet."}</b>
          <p className="meta" style={{ margin: "4px 0 0" }}>
            Each Sales scan saves what people said in the conversations it keeps: a one-line summary and their own words.{" "}
            <Link href="/app/sales">Open Sales</Link>
          </p>
        </div>
      ) : null}
      {themes.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: "12px" }}>
          {themes.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onWrite={write} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
