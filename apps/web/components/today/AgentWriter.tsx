"use client";

import Link from "next/link";
import { useState } from "react";

import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { openScript } from "@/components/cards/open-script";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { JOB_PRICES } from "@/lib/cmo/jobs/progress";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import type { WriterScreen } from "@/lib/screens/writer";

import { KIND_ICON, PLATFORM_ICON } from "./cards";
import { useDecide } from "./useDecide";

type Draft = WriterScreen["drafts"][number];
type Tab = "week" | "drafts" | "voice";

const KIND_LABEL: Record<Draft["kind"], string> = { post: "post", caption: "Caption", video_brief: "Script · you film", slide_text: "Slideshow" };
const BADGE: Record<Draft["column"], [string, string]> = { waiting: ["Waiting", "badge b-wait"], drafting: ["Drafting", "badge b-new"], scheduled: ["Scheduled", "badge b-ok"], posted: ["Posted", "badge b-ok"] };
const ASK_KINDS = [
  { id: "post", label: "X post", prompt: "Write an X post" },
  { id: "slides", label: "Slideshow", prompt: "Write a slideshow" },
  { id: "script", label: "Video script", prompt: "Write a short video script" },
] as const;

const when = (d: Draft) => {
  if (!d.at) return d.dayText ?? "";
  const t = new Date(d.at);
  return `${t.toLocaleDateString("en-GB", { weekday: "short" })} ${t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
const kindOf = (d: Draft) => (d.kind === "post" ? `${PLATFORM_LABEL[d.platform]} post` : KIND_LABEL[d.kind]);
const iconOf = (d: Draft) => (d.kind === "video_brief" ? KIND_ICON.script : d.kind === "slide_text" ? KIND_ICON.slideshow : d.kind === "caption" ? KIND_ICON.price : (PLATFORM_ICON[d.platform] ?? KIND_ICON.post));

/**
 * The Writer agent page (AgentWriter.dc.html). Asking for a post goes through the CMO chat, which shows its price card
 * before anything runs (charge before running). A waiting row opens its real card in place; an approved script offers
 * the phone prompter and the editor.
 */
export function AgentWriter() {
  const [state, reload] = useScreen("writer");
  const [dash, reloadCards] = useScreen("dashboard");
  const { focusChat } = useShellState();
  const [tab, setTab] = useState<Tab>("week");
  const [open, setOpen] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [askKind, setAskKind] = useState<(typeof ASK_KINDS)[number]["id"]>("post");
  const data = state.status === "ready" ? state.data : null;
  const queue = dash.status === "ready" ? ((dash.data as { queue: Card[] }).queue ?? []) : [];
  const sample = !(dash.status === "ready" && (dash.live as { queue?: boolean }).queue);
  const onDecide = useDecide(sample, () => {
    reload();
    reloadCards();
  });

  const drafts = data?.drafts ?? [];
  const waiting = drafts.filter((d) => d.column === "waiting");
  const approved = drafts.filter((d) => d.column === "scheduled" || d.column === "posted").length;
  const shown = tab === "week" ? [...waiting, ...drafts.filter((d) => d.column !== "waiting")] : tab === "drafts" ? drafts.filter((d) => d.column === "drafting") : [];
  const firstOpen = open ?? waiting[0]?.id ?? null;
  const askPrompt = ASK_KINDS.find((k) => k.id === askKind)!;

  function write() {
    focusChat();
    fillChat(`${askPrompt.prompt}${ask.trim() ? `: ${ask.trim()}` : "."}`);
    setAsk("");
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", maxWidth: "1320px", margin: "0 auto", padding: "22px 24px 40px", gap: "24px" }} data-testid="v2-writer">
      <main style={{ flex: "999 1 600px", minWidth: "0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", flexWrap: "wrap" }}>
          <span className="tile">
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "20px", height: "20px" }}>
              <path d="M12 20h9" />
              <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
            </svg>
          </span>
          <div style={{ flex: "1 1 300px", minWidth: "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>Writer</h1>
              {drafts.length ? (
                <span className="chip">
                  <span className="live"></span>
                  {drafts.length} drafts this week
                </span>
              ) : null}
            </div>
            <p style={{ margin: "4px 0 8px", color: "var(--muted)", fontSize: "14px", maxWidth: "640px" }}>
              Writes the week from your strategy: X posts, slideshows, and scripts with storyboards for the videos you film. Nothing is built or posted until you approve the words.
            </p>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span className="meta">Reads</span>
              <span className="chip">Strategy</span>
              <span className="chip">Content plan</span>
              <span className="chip">Product</span>
              <span className="chip">Your voice</span>
            </div>
          </div>
        </div>

        <form
          className="ask"
          style={{ marginTop: "18px" }}
          onSubmit={(e) => {
            e.preventDefault();
            write();
          }}
        >
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--subtle)" }}>
            <path d="M12 20h9" />
            <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
          </svg>
          <label htmlFor="ask-writer" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Ask for a post
          </label>
          <input id="ask-writer" type="text" placeholder="Ask for a post, a slideshow or a video script" value={ask} onChange={(e) => setAsk(e.target.value)} />
          <label htmlFor="ask-kind" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Kind
          </label>
          <select id="ask-kind" className="pill" style={{ height: "30px" }} value={askKind} onChange={(e) => setAskKind(e.target.value as typeof askKind)}>
            {ASK_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <button type="submit" className="primary">
            Write it · {JOB_PRICES.post_draft ?? 1} credit
          </button>
        </form>

        <div className="tabs" role="tablist" aria-label="Writer">
          {(
            [
              ["week", "This week"],
              ["drafts", "All drafts"],
              ["voice", "Voice"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {state.status === "loading" ? <div className="meta" style={{ marginTop: "14px" }}>Loading…</div> : null}
        {state.status === "error" ? <div className="meta" style={{ marginTop: "14px" }}>{state.message}</div> : null}

        {tab !== "voice" && data ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0 10px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: "600" }}>{waiting.length} waiting for your OK</span>
              <span className="meta">· {approved} approved this week</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {shown.length === 0 ? <div className="meta">Nothing here yet. Writer drafts the week from your strategy every Sunday.</div> : null}
              {shown.map((d) => {
                const card = d.approvalId ? queue.find((c) => c.id === d.approvalId) : undefined;
                const opens = Boolean(card) || Boolean(d.scriptId);
                const isOpen = opens && firstOpen === d.id;
                return (
                  <div key={d.id} className="th" data-open={isOpen}>
                    <button type="button" className="row" onClick={opens ? () => setOpen(isOpen ? "" : d.id) : undefined} aria-expanded={opens ? isOpen : undefined} style={opens ? undefined : { cursor: "default" }}>
                      <span className="st">{iconOf(d)}</span>
                      <span className="ttl">
                        <span className="kind">{kindOf(d)} · </span>
                        {d.title}
                      </span>
                      <span className={BADGE[d.column][1]}>{BADGE[d.column][0]}</span>
                      <span className="meta" style={{ width: "64px", textAlign: "right" }}>
                        {when(d)}
                      </span>
                    </button>
                    {isOpen && card ? (
                      <div className="detail td-cardhost">
                        <ApprovalCard card={card} sample={sample} onDecide={onDecide} open />
                      </div>
                    ) : null}
                    {isOpen && !card && d.scriptId ? (
                      <div className="detail">
                        <div className="meta">{d.note ?? "Approved: you record it."} Film it, then upload the take in the editor.</div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                          <Link href={`/app/script/${encodeURIComponent(d.scriptId)}/prompter`} className="ghost" style={{ textDecoration: "none" }}>
                            <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                              <path d="M12 18h.01" />
                            </svg>
                            Read on your phone
                          </Link>
                          <div style={{ flex: "1 1 auto" }}></div>
                          <button type="button" className="primary" onClick={() => void openScript(d.scriptId!)}>
                            Open in editor
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {tab === "voice" && data ? (
          <section className="card" style={{ marginTop: "14px" }}>
            {data.voice.lines.length === 0 ? <div className="meta">Writer learns your voice from what you change in its drafts.</div> : null}
            {data.voice.lines.map((line) => (
              <div key={line.text} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontWeight: "500" }}>{line.text}</div>
                <div className="meta">{line.source}</div>
              </div>
            ))}
            <div style={{ marginTop: "10px" }}>
              <Link href="/app/library?tab=voice" className="ghost" style={{ textDecoration: "none" }}>
                Edit your voice
              </Link>
            </div>
          </section>
        ) : null}
      </main>

      <aside style={{ flex: "1 1 300px", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
            <h2 style={{ margin: "0", fontSize: "14px", fontWeight: "600" }}>This week</h2>
            <Link href="/app/schedule" style={{ fontSize: "12.5px", textDecoration: "none" }}>
              Calendar
            </Link>
          </div>
          {drafts.length === 0 ? <div className="meta">The week's plan lands here on Sunday.</div> : null}
          {drafts.slice(0, 7).map((d) => (
            <div key={d.id} className="day">
              <span className="d">{(d.at ? new Date(d.at).toLocaleDateString("en-GB", { weekday: "short" }) : (d.dayText ?? "").slice(0, 3)).toUpperCase()}</span>
              <span className="dot" style={{ background: d.column === "posted" || d.column === "scheduled" ? "var(--ok)" : "var(--warn)" }}></span>
              <span style={{ flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kindOf(d)}</span>
              <span className="meta">{BADGE[d.column][0].toLowerCase()}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <h2 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: "600" }}>Your voice</h2>
          <p className="meta" style={{ margin: "0 0 10px", fontSize: "13px" }}>
            Writer learns your voice from what you change in its drafts.
          </p>
          {data?.voice.wordsCut.length ? (
            <>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Words you cut
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                {data.voice.wordsCut.map((w) => (
                  <span key={w} className="cut">
                    {w}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {data?.voice.lines.length ? (
            <>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Rules it keeps
              </div>
              <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "13.5px", lineHeight: "1.6" }}>
                {data.voice.lines.slice(0, 4).map((l) => (
                  <li key={l.text}>{l.text}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section className="card">
          <h2 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: "600" }}>What it costs</h2>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>Week plan</span>
            <span className="meta">{JOB_PRICES.plan_week ?? 1} credit</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>Extra post or script</span>
            <span className="meta">{JOB_PRICES.post_draft ?? 1} credit</span>
          </div>
        </section>
      </aside>
    </div>
  );
}
