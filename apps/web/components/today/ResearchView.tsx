"use client";

import { useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { useScreen } from "@/components/screens/useScreen";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { CompetitorView } from "@/lib/screens/research";

import { ResearchChat } from "./ResearchChat";

/** The colour squares of the competitors' marks, in order (the canvas draws each in its own colour). */
export const MARKS = ["#1f8a5b", "#ff6b35", "#0075dd", "#2d3e50", "#1c6ef2", "#e42527", "#8a63d2", "#c9a227"];

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

function CompetitorCard({ c, index, onRemove }: { c: CompetitorView; index: number; onRemove: (c: CompetitorView) => void }) {
  const week = thisWeek(c);
  const total = c.mentions.reduce((n, m) => n + m.count, 0);
  return (
    <article className="card" data-testid="research-competitor" style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Mark name={c.name} index={index} />
        <span style={{ minWidth: "0", flex: "1 1 auto" }}>
          <b style={{ fontWeight: "600", display: "block" }}>{c.name}</b>
          <span className="meta" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <a href={`https://${c.site}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              {c.site}
            </a>
            {c.price ? ` · ${c.price}` : ""}
          </span>
        </span>
        <span className="meta" title={total ? `${total} in the last 8 weeks` : undefined} style={{ whiteSpace: "nowrap", color: week ? "var(--ok)" : undefined }}>
          {week} this week
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

  async function add() {
    setAdding(true);
    setError(null);
    try {
      const added = await api<{ name: string; read: boolean }>("/research/competitors", jsonBody({ url: url.trim() }));
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
    <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "22px 24px 40px", display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }} data-testid="v2-research">
      <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div>
          <h1 style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>Competitors</h1>
          <p className="meta" style={{ margin: "4px 0 0", fontSize: "14px" }}>
            {list.length ? `${list.length} you keep. ` : ""}Sales notes each time people mention one in the conversations it reads.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void add();
          }}
          style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
        >
          <label htmlFor="research-add" className="meta">
            Add one
          </label>
          <input id="research-add" type="text" inputMode="url" placeholder="competitor.com" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: "1 1 220px", minWidth: "0", height: "34px", padding: "0 10px", border: "1px solid var(--line-2)", borderRadius: "7px", background: "var(--bg)", color: "var(--text)", font: "inherit" }} />
          <button type="submit" className="primary" disabled={adding || !url.trim()}>
            {adding ? "Reading their site…" : "Add"}
          </button>
          {withChat ? null : (
            <button type="button" className="ghost" onClick={() => focusChat()}>
              or ask the chat to find them
            </button>
          )}
        </form>
        {error ? (
          <p role="alert" className="meta" style={{ color: "var(--warn)", margin: "0" }}>
            {error}
          </p>
        ) : null}
        {state.status === "loading" ? <p className="meta">Loading…</p> : null}
        {state.status === "error" ? <p className="meta">{state.message}</p> : null}
        {state.status === "ready" && list.length === 0 ? (
          <div className="card" data-testid="research-empty">
            <b>No competitors yet.</b>
            <p className="meta" style={{ margin: "4px 0 0" }}>
              Paste the website of a tool your customers compare you with. Its name, price and what it sells come from its own site.
            </p>
          </div>
        ) : null}
        {list.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: "12px" }}>
            {list.map((c, i) => (
              <CompetitorCard key={c.id} c={c} index={i} onRemove={(x) => void remove(x)} />
            ))}
          </div>
        ) : null}
      </main>
      {withChat ? <ResearchChat onAdded={reload} /> : null}
    </div>
  );
}
