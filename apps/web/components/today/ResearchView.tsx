"use client";

import { useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { useScreen } from "@/components/screens/useScreen";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { CompetitorView } from "@/lib/screens/research";

import { CompanyLogo } from "./company-logo";
import { ResearchChat } from "./ResearchChat";
import { siteLabel, useWorkspace } from "./workspace";

/** The colour squares of the competitors' marks, in order (the canvas draws each in its own colour). */
// Every mark holds white text at 4.5:1 or more (axe color-contrast, WCAG AA).
export const MARKS = ["#17724b", "#c2410c", "#0067c2", "#2d3e50", "#1a5fd6", "#c81e1e", "#7a4fc4", "#8a6d0f"];

/** "Invoice Ninja" → "IN", "Bonsai" → "B". */
export function markOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [words[0]?.[0] ?? "?"]).join("").toUpperCase();
}

export function Mark({ name, index, size = 28 }: { name: string; index: number; size?: number }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: `${size}px`, height: `${size}px`, borderRadius: "7px", background: MARKS[index % MARKS.length], color: "#fff", display: "grid", placeItems: "center", fontSize: `${Math.round(size * 0.42)}px`, fontWeight: "700" }}>
      {markOf(name)}
    </span>
  );
}

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
    <article className="card" data-testid="research-competitor" style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <CompanyLogo name={c.name} site={c.site} size={36} />
        <span style={{ minWidth: "0", flex: "1 1 auto" }}>
          <b style={{ fontWeight: "600", display: "block" }}>{c.name}</b>
          <span className="meta" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <a href={`https://${c.site}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              {c.site}
            </a>
            {c.price ? ` · ${c.price}` : ""}
          </span>
        </span>
        <span className="sec-stat" title={`Named in ${week} conversations this week${total ? `, ${total} in the last 8 weeks` : ""}`} style={{ height: "30px", background: "var(--raised)", color: week ? "var(--sec-find)" : "var(--muted)" }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
          </svg>
          {week}
          <span className="sr-only"> this week</span>
        </span>
      </div>
      {c.offer ? <p style={{ margin: "0", fontSize: "13.5px" }}>{c.offer}</p> : <p className="meta" style={{ margin: "0" }}>Its site said nothing we could read about what it sells.</p>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <span className="meta">{c.addedVia === "chat" ? "Found in the chat" : "Added by website"}</span>
        <button type="button" className="skip" onClick={() => onRemove(c)}>
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
    <div data-sec="biz" style={{ maxWidth: "1320px", margin: "0 auto", padding: "22px 24px 40px", display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }} data-testid="v2-research">
      <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
        <form
          className="sec-band"
          style={{ marginBottom: "0" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void add(url.trim());
          }}
        >
          <span className="sec-tile">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
            </svg>
          </span>
          <h1>Competitors</h1>
          {list.length ? <span className="sec-chip">{list.length}</span> : null}
          <span style={{ flex: "1 1 auto" }}></span>
          <label htmlFor="research-add" className="sr-only">
            Add one
          </label>
          <input id="research-add" type="text" inputMode="url" placeholder="competitor.com" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: "0 1 260px", minWidth: "0", height: "38px", padding: "0 12px", border: "1px solid var(--sec-line)", borderRadius: "10px", background: "var(--panel)", color: "var(--text)", font: "inherit" }} />
          <button type="submit" className="primary" disabled={adding || !url.trim()}>
            {adding ? "Reading their site…" : "Add"}
          </button>
          {withChat ? null : (
            <button type="button" className="ghost" onClick={() => focusChat()} title="Ask the chat to find them">
              Find more
            </button>
          )}
        </form>
        {/* You first, by your own logo (owner, 2026-11-23). */}
        <article className="card" data-testid="research-you" style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--sec-find-wash)", borderColor: "var(--sec-find-line)" }}>
          <CompanyLogo name={you} site={ws.site} size={36} you />
          <b style={{ flex: "1 1 auto", fontWeight: "650" }}>{you}</b>
          <span style={{ fontSize: "11px", fontWeight: "750", letterSpacing: "0.12em", color: "var(--sec-find)" }}>YOU</span>
        </article>
        {error ? (
          <p role="alert" className="meta" style={{ color: "var(--warn)", margin: "0" }}>
            {error}
          </p>
        ) : null}
        {state.status === "loading" ? <p className="meta">Loading…</p> : null}
        {state.status === "error" ? <p className="meta">{state.message}</p> : null}
        {state.status === "ready" && list.length === 0 && named.length ? (
          // The Competitors document names them, but none is kept yet (E2E 2026-11-23: the Context column showed four
          // while this page said "No competitors yet"). Keep reads each one's site.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: "12px" }} data-testid="research-named">
            {named.map((c) => (
              <article key={c.name} className="card" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <CompanyLogo name={c.name} site={c.website} size={36} />
                <span style={{ flex: "1 1 auto", minWidth: "0" }}>
                  <b style={{ display: "block", fontWeight: "600" }}>{c.name}</b>
                  <span className="meta" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{siteLabel(c.website) ?? ""}</span>
                </span>
                {c.website ? (
                  <button type="button" className="ghost" disabled={adding} onClick={() => void add(c.website)}>
                    Keep
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        {state.status === "ready" && list.length === 0 && !named.length ? (
          <div className="card" data-testid="research-empty">
            <b>No competitors yet.</b>
            <p className="meta" style={{ margin: "4px 0 0" }}>
              Paste the website of a tool your customers compare you with.
            </p>
          </div>
        ) : null}
        {list.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "12px" }}>
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
