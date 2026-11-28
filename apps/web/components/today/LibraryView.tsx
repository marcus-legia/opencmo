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
import { PageHeader } from "./PageHeader";
import { hasLogo, PlatformMark } from "./platform-logos";

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
    <section className="ui-card uip-theme" data-testid="library-theme" aria-labelledby={`theme-${theme.id}`}>
      <div className="uip-theme__head">
        <h2 id={`theme-${theme.id}`}>{theme.name}</h2>
        <span className="ui-t-xs ui-muted ui-num">{plural(theme.count, "conversation", "conversations")}</span>
        {theme.thisWeek > 0 ? (
          <span className="ui-chip ui-num" data-tone="ok">
            +{theme.thisWeek} this week
          </span>
        ) : (
          <span className="ui-t-xs ui-subtle">none new this week</span>
        )}
      </div>
      {quotes.length ? (
        <ul className="uip-quotes">
          {quotes.map((q) => (
            <li key={q.id} data-testid="library-quote">
              <blockquote>“{bare(q.text)}”</blockquote>
              <span className="uip-quotes__where">
                {hasLogo(q.platform) ? <PlatformMark platform={q.platform} size={13} /> : null}
                {q.where}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {theme.entries[0] ? <p className="ui-t-sm ui-muted uip-flat">Latest: {theme.entries[0].summary}</p> : null}
      <div className="uip-theme__foot">
        <span className="ui-t-xs ui-muted">{theme.usedInPosts > 0 ? `Used in ${plural(theme.usedInPosts, "post", "posts")}` : "Not used in a post yet"}</span>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onWrite(theme.name)}>
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
  const status = counts
    ? [plural(counts.total, "conversation", "conversations"), counts.thisWeek > 0 ? `+${counts.thisWeek} this week` : null, "what people said, in their own words"].filter(Boolean).join(" · ")
    : "What people said in the conversations Sales kept, in their own words";

  return (
    <div className="uip uip-library" data-testid="v2-library">
      <PageHeader title="Library" status={status}>
        <nav aria-label="Filter by source" className="uip-filters">
          {tabs.map((t) => {
            const on = t.id === source;
            return (
              <Link
                key={t.id ?? "all"}
                href={t.id ? `/app/library?source=${t.id}` : "/app/library"}
                scroll={false}
                aria-current={on ? "page" : undefined}
                data-testid="library-filter"
                className="uip-filter"
                data-empty={t.n === 0 && !on ? "" : undefined}
              >
                {t.id && hasLogo(t.id) ? <PlatformMark platform={t.id} size={13} /> : null}
                {t.label}{" "}
                {t.n !== null ? <span className="uip-filter__n ui-num">{t.n}</span> : null}
              </Link>
            );
          })}
        </nav>
      </PageHeader>

      {state.status === "loading" ? <p className="ui-t-sm ui-muted">Loading…</p> : null}
      {state.status === "error" ? <p className="ui-t-sm ui-muted">{state.message}</p> : null}
      {state.status === "ready" && themes.length === 0 ? (
        <div className="ui-card ui-empty" data-testid="library-empty">
          <p className="ui-empty__title">{source ? `Nothing from ${PLATFORM_LABEL[source]} yet.` : "Nothing saved yet."}</p>
          <p>Each Sales scan saves what people said in the conversations it keeps: a one-line summary and their own words.</p>
          <div className="ui-row">
            <Link href="/app/sales" className="ui-btn ui-btn--ghost">
              Open Sales
            </Link>
          </div>
        </div>
      ) : null}
      {themes.length ? (
        <div className="uip-themes">
          {themes.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} onWrite={write} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
