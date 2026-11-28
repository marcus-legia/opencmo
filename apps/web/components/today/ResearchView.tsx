"use client";

import { useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { useScreen } from "@/components/screens/useScreen";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { CompetitorView } from "@/lib/screens/research";

import { CompanyLogo } from "./company-logo";
import { PageHeader } from "./PageHeader";
import { ResearchChat } from "./ResearchChat";
import { siteLabel, useWorkspace } from "./workspace";

/** This week's Monday as `YYYY-MM-DD` (UTC), the key `my_competitor_mentions` counts by. */
function mondayOf(day = new Date()): string {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - ((day.getUTCDay() + 6) % 7)));
  return d.toISOString().slice(0, 10);
}

/** Mentions in Sales conversations this week (the week starting Monday). */
const thisWeek = (c: CompetitorView) => c.mentions.find((m) => m.week === mondayOf())?.count ?? 0;

function CompetitorCard({ c, onRemove }: { c: CompetitorView; onRemove: (c: CompetitorView) => void }) {
  const week = thisWeek(c);
  const total = c.mentions.reduce((n, m) => n + m.count, 0);
  return (
    <article className="ui-card uip-rival" data-testid="research-competitor">
      <div className="uip-rival__head">
        <CompanyLogo name={c.name} site={c.site} size={32} />
        <span className="uip-rival__who">
          <b>{c.name}</b>
          <span className="ui-t-xs ui-muted uip-ellipsis">
            <a href={`https://${c.site}`} target="_blank" rel="noopener noreferrer">
              {c.site}
            </a>
            {c.price ? ` · ${c.price}` : ""}
          </span>
        </span>
        <span className="ui-chip ui-num" data-tone={week ? "accent" : undefined} title={`Named in ${week} conversations this week${total ? `, ${total} in the last 8 weeks` : ""}`}>
          {week} this week
        </span>
      </div>
      {c.offer ? <p className="ui-t-sm uip-flat">{c.offer}</p> : <p className="ui-t-sm ui-muted uip-flat">Its site said nothing we could read about what it sells.</p>}
      <div className="uip-rival__foot">
        <span className="ui-t-xs ui-subtle">{c.addedVia === "chat" ? "Found in the chat" : "Added by website"}</span>
        <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => onRemove(c)}>
          Remove
        </button>
      </div>
    </article>
  );
}

/**
 * Research (wave 3, canvas board Research): the competitors the founder keeps, from their own sites (name, price,
 * what they sell) and how often Sales conversations mention them. Add one by pasting a website, or ask the chat to find
 * others in its own chat panel (C8); nothing is searched on its own (owner, 2026-11-18).
 */
export function ResearchView({ withChat = false }: { withChat?: boolean }) {
  const [state, reload] = useScreen("research");
  const { toast, focusChat } = useShellState();
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = state.status === "ready" ? state.data.competitors : [];
  const live = state.status === "ready" && state.live.competitors;
  const ws = useWorkspace();
  const you = ws.name ?? siteLabel(ws.site) ?? "Your business";
  const named = ws.competitors.filter((c) => c.name);
  const mentioned = list.reduce((sum, c) => sum + thisWeek(c), 0);

  async function add(site: string) {
    setAdding(true);
    setError(null);
    try {
      const added = await api<{ name: string; read: boolean }>("/research/competitors", jsonBody({ url: site }));
      setUrl("");
      toast(added.read ? `${added.name} added. Sales now notes when people mention it.` : `${added.name} added. Its site could not be read, so only its name and address are kept.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add it. Try again.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(c: CompetitorView) {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    try {
      if (live) await api("/research/competitors", jsonBody({ id: c.id }, "DELETE"));
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove it.");
    }
  }

  return (
    <div className="uip uip-research" data-has-chat={withChat ? "" : undefined} data-testid="v2-research">
      <main className="uip-research__main">
        <PageHeader
          title="Competitors"
          status={list.length ? `${list.length} kept · named in ${mentioned} ${mentioned === 1 ? "conversation" : "conversations"} this week` : "The tools your customers compare you with"}
          actions={
            withChat ? null : (
              <button type="button" className="ui-btn ui-btn--ghost" onClick={() => focusChat()} title="Ask the chat to find them">
                Find more
              </button>
            )
          }
        >
          <form
            className="uip-addform"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) void add(url.trim());
            }}
          >
            <label htmlFor="research-add" className="sr-only">
              Add one
            </label>
            <input id="research-add" className="ui-input" type="text" inputMode="url" placeholder="Paste a website: competitor.com" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" className="ui-btn ui-btn--primary" disabled={adding || !url.trim()}>
              {adding ? "Reading their site…" : "Add"}
            </button>
          </form>
        </PageHeader>
        {error ? (
          <p role="alert" className="ui-t-sm uip-flat" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}
        {/* You first, by your own logo (owner, 2026-11-23). */}
        <article className="uip-you" data-testid="research-you">
          <CompanyLogo name={you} site={ws.site} size={28} you />
          <b>{you}</b>
          <span className="ui-chip">You</span>
        </article>
        {state.status === "loading" ? <p className="ui-t-sm ui-muted">Loading…</p> : null}
        {state.status === "error" ? <p className="ui-t-sm ui-muted">{state.message}</p> : null}
        {state.status === "ready" && list.length === 0 && named.length ? (
          // The Competitors document names them, but none is kept yet (E2E 2026-11-23: the Context column showed four
          // while this page said "No competitors yet"). Keep reads each one's site.
          <section aria-labelledby="research-named-title" className="ui-stack">
            <h2 id="research-named-title" className="ui-t-sm uip-flat" style={{ fontWeight: 600 }}>
              Named in your Competitors document
            </h2>
            <div className="uip-cards uip-cards--sm" data-testid="research-named">
              {named.map((c) => (
                <article key={c.name} className="ui-card uip-rival__head">
                  <CompanyLogo name={c.name} site={c.website} size={32} />
                  <span className="uip-rival__who">
                    <b>{c.name}</b>
                    <span className="ui-t-xs ui-muted uip-ellipsis">{siteLabel(c.website) ?? ""}</span>
                  </span>
                  {c.website ? (
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={adding} onClick={() => void add(c.website)}>
                      Keep
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {state.status === "ready" && list.length === 0 && !named.length ? (
          <div className="ui-card ui-empty" data-testid="research-empty">
            <p className="ui-empty__title">No competitors yet.</p>
            <p>Paste the website of a tool your customers compare you with.</p>
          </div>
        ) : null}
        {list.length ? (
          <div className="uip-cards">
            {list.map((c) => (
              <CompetitorCard key={c.id} c={c} onRemove={(x) => void remove(x)} />
            ))}
          </div>
        ) : null}
      </main>
      {withChat ? <ResearchChat onAdded={reload} /> : null}
    </div>
  );
}
