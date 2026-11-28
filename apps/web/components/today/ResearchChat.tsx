"use client";

import { useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import type { CompetitorIdea } from "@/lib/agent/cmo-competitors";

import { useWorkspace } from "./workspace";

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
    <li data-testid="research-idea" className="uip-idea">
      <div className="uip-idea__head">
        <b>{idea.name}</b>
        <span className="ui-t-xs ui-muted ui-num">
          {idea.mentions} {idea.mentions === 1 ? "mention" : "mentions"}
        </span>
      </div>
      <span className="ui-t-sm">{idea.why}</span>
      <a href={idea.where.url} target="_blank" rel="noopener noreferrer nofollow" className="ui-t-xs">
        Seen on {idea.where.source}
      </a>
      {added ? (
        <span className="ui-t-xs" role="status" style={{ color: "var(--ok)" }}>
          Added to your competitors.
        </span>
      ) : site === null ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setSite("")}>
          Add
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
          className="uip-idea__form"
        >
          <label className="ui-label" htmlFor={`idea-site-${idea.name}`}>
            Its website
          </label>
          <input id={`idea-site-${idea.name}`} className="ui-input" type="text" inputMode="url" autoFocus placeholder="theirsite.com" value={site} onChange={(e) => setSite(e.target.value)} />
          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || !site.trim()}>
            {busy ? "Adding…" : "Add"}
          </button>
          {error ? (
            <span role="alert" className="ui-t-xs" style={{ width: "100%", color: "var(--danger)" }}>
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
  // The example comes from the founder's own Product document: another product's example ("chase unpaid invoices")
  // read as if Ferreto had mixed up whose business this is (production 28/11).
  const { category } = useWorkspace();
  const example = category ? `e.g. ${category.replace(/[.\s]+$/, "")}` : "what your product does, in a few words";

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
    <aside aria-label="Find competitors" className="ui-card uip-ask" data-testid="research-chat">
      <h2 className="uip-ask__title">Ask what else they use</h2>
      <p className="ui-t-sm ui-muted uip-flat">Searches Reddit, Hacker News and the web for the tools people mention. Nothing is added until you press Add.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="ui-stack"
        style={{ gap: "var(--sp-2)" }}
      >
        <label className="ui-label" htmlFor="research-ask" style={{ margin: 0 }}>
          What do the tools do, in your customers&apos; words?
        </label>
        <input id="research-ask" className="ui-input" type="text" placeholder={example} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120} />
        <button type="submit" className="ui-btn ui-btn--primary" disabled={busy || query.trim().length < 2} style={{ alignSelf: "flex-end" }}>
          {busy ? "Looking…" : "Find them"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="ui-t-sm uip-flat" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      {answers.map((a) => (
        <section key={a.query} aria-label={`Names for ${a.query}`}>
          <div className="ui-t-xs ui-muted" style={{ fontWeight: 500 }}>
            “{a.query}”
          </div>
          {a.ideas.length ? (
            <ul className="uip-ideas">
              {a.ideas.map((idea) => (
                <Idea key={idea.name} idea={idea} onAdded={onAdded} />
              ))}
            </ul>
          ) : (
            <p className="ui-t-sm ui-muted uip-flat" style={{ marginTop: "var(--sp-1)" }}>
              No new names. People did not mention a tool you do not list already.
            </p>
          )}
          {a.failed.length ? (
            <p className="ui-t-xs ui-muted uip-flat" style={{ marginTop: "var(--sp-1)" }}>
              {a.failed.join(" and ")} did not answer.
            </p>
          ) : null}
        </section>
      ))}
    </aside>
  );
}
