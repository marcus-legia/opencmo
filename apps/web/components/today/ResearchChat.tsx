"use client";

import { useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import type { CompetitorIdea } from "@/lib/agent/cmo-competitors";

type Answer = { query: string; ideas: CompetitorIdea[]; failed: string[] };

/** One name people mention, with why and where, and Add: the founder gives its website, then it is read and kept. */
function Idea({ idea, onAdded }: { idea: CompetitorIdea; onAdded: () => void }) {
  const [site, setSite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  async function add() {
    if (!site?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/research/competitors", jsonBody({ url: site.trim(), name: idea.name, via: "chat" }));
      setAdded(true);
      setSite(null);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li data-testid="research-idea" style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <b style={{ fontWeight: "600" }}>{idea.name}</b>
        <span className="meta" style={{ marginLeft: "auto" }}>
          {idea.mentions} {idea.mentions === 1 ? "mention" : "mentions"}
        </span>
      </div>
      <span style={{ fontSize: "13.5px" }}>{idea.why}</span>
      <a href={idea.where.url} target="_blank" rel="noopener noreferrer nofollow" className="meta">
        Seen on {idea.where.source}
      </a>
      {added ? (
        <span className="meta" role="status" style={{ color: "var(--ok)" }}>
          Added to your competitors.
        </span>
      ) : site === null ? (
        <button type="button" className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSite("")}>
          Add
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
          style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}
        >
          <label className="meta" htmlFor={`idea-site-${idea.name}`} style={{ width: "100%" }}>
            Its website
          </label>
          <input id={`idea-site-${idea.name}`} type="text" inputMode="url" autoFocus placeholder="theirsite.com" value={site} onChange={(e) => setSite(e.target.value)} style={{ flex: "1 1 140px", minWidth: "0", height: "32px", padding: "0 8px", border: "1px solid var(--line-2)", borderRadius: "7px", background: "var(--bg)", color: "var(--text)", font: "inherit" }} />
          <button type="submit" className="primary" disabled={busy || !site.trim()}>
            {busy ? "Adding…" : "Add"}
          </button>
          {error ? (
            <span role="alert" className="meta" style={{ width: "100%", color: "var(--warn)" }}>
              {error}
            </span>
          ) : null}
        </form>
      )}
    </li>
  );
}

/**
 * Research's own chat (wave 3, canvas board Research): the founder asks what else their customers use; the answer is
 * names people mention on Reddit, Hacker News and the web, each with why, where and an Add button. Nothing is searched
 * or added on its own (owner, 2026-11-18).
 */
export function ResearchChat({ onAdded }: { onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);

  async function ask() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api<Answer>("/research/find", jsonBody({ query: q }));
      setAnswers((all) => [answer, ...all].slice(0, 5));
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not look right now. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-label="Find competitors" className="card" data-testid="research-chat" style={{ flex: "1 1 300px", maxWidth: "380px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <b>Ask what else they use</b>
      <p className="meta" style={{ margin: "0" }}>
        Searches Reddit, Hacker News and the web for the tools people mention. Nothing is added until you press Add.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "6px" }}
      >
        <label className="meta" htmlFor="research-ask">
          What do the tools do, in your customers&apos; words?
        </label>
        <input id="research-ask" type="text" placeholder="chase unpaid invoices" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120} style={{ height: "34px", padding: "0 10px", border: "1px solid var(--line-2)", borderRadius: "7px", background: "var(--bg)", color: "var(--text)", font: "inherit" }} />
        <button type="submit" className="primary" disabled={busy || query.trim().length < 2} style={{ alignSelf: "flex-end" }}>
          {busy ? "Looking…" : "Find them"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="meta" style={{ margin: "0", color: "var(--warn)" }}>
          {error}
        </p>
      ) : null}
      {answers.map((a) => (
        <section key={a.query} aria-label={`Names for ${a.query}`}>
          <div className="meta" style={{ fontWeight: "500" }}>
            “{a.query}”
          </div>
          {a.ideas.length ? (
            <ul style={{ listStyle: "none", margin: "0", padding: "0" }}>
              {a.ideas.map((idea) => (
                <Idea key={idea.name} idea={idea} onAdded={onAdded} />
              ))}
            </ul>
          ) : (
            <p className="meta" style={{ margin: "4px 0 0" }}>
              No new names. People did not mention a tool you do not list already.
            </p>
          )}
          {a.failed.length ? <p className="meta" style={{ margin: "4px 0 0" }}>{a.failed.join(" and ")} did not answer.</p> : null}
        </section>
      ))}
    </aside>
  );
}
