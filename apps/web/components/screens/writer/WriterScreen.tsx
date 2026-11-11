"use client";

import { useState } from "react";

import { openScript } from "@/components/cards/open-script";
import { Icon, type IconName } from "@/components/icons";
import { useShellState } from "@/components/shell-v2/ShellState";
import { Button, Tabs } from "@/components/ui";
import { PLATFORM_LABEL, type Platform } from "@/lib/screens/common";
import { WRITER_COLUMNS, WRITER_KINDS, type WriterScreen as Data } from "@/lib/screens/writer";

import { ErrorNote, PageHeader, Panel, Pills, Screen, SkeletonBlocks } from "../parts";
import { useTabParam } from "../useTabParam";
import { isSample, useScreen } from "../useScreen";

type Kind = (typeof WRITER_KINDS)[number];
type Draft = Data["drafts"][number];

const KIND_LABEL: Record<Kind, string> = { post: "Posts", caption: "Captions", video_brief: "Video briefs", slide_text: "Slide text" };
const COLUMN_LABEL: Record<(typeof WRITER_COLUMNS)[number], string> = {
  drafting: "Drafting",
  waiting: "Waiting on you",
  scheduled: "Scheduled",
  posted: "Posted",
};
/** Text platforms Writer drafts posts for; the chips filter the board. */
const PLATFORM_FILTERS = ["all", "x", "threads", "linkedin"] as const;
type PlatformFilter = (typeof PLATFORM_FILTERS)[number];

function slotText(d: Draft): string {
  const where = PLATFORM_LABEL[d.platform];
  if (!d.at) return d.dayText ? `${where} · ${d.dayText}` : where;
  const t = new Date(d.at);
  const day = t.toLocaleDateString("en-GB", { weekday: "short" });
  const time = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${where} · ${day} ${time}`;
}

export function WriterScreen() {
  const [state] = useScreen("writer");
  const { focusChat } = useShellState();
  const [kind, setKind] = useTabParam<Kind>("kind", WRITER_KINDS, "post");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const data = state.status === "ready" ? state.data : null;
  const count = (k: Kind) => data?.drafts.filter((d) => d.kind === k).length ?? 0;

  return (
    <Screen label="Writer">
      <PageHeader
        numeral="II"
        eyebrow="Writer"
        title="Writer"
        sub="Writes the week from your strategy: posts, captions, slide text, and scripts for the videos you film. Nothing is built or posted until you approve the words."
        sample={state.status === "ready" && isSample(state.live)}
        actions={
          <Button variant="primary" onClick={focusChat}>
            <Icon name="pencil" size={14} />
            Ask for a post
          </Button>
        }
      />
      <div className="scr-toolbar">
        <Tabs<Kind> label="Kind" idBase="writer-kind" panel={false} items={WRITER_KINDS.map((k) => ({ id: k, label: `${KIND_LABEL[k]} · ${count(k)}` }))} value={kind} onChange={setKind} />
        <Pills
          label="Platform"
          options={PLATFORM_FILTERS.map((p) => ({ id: p, label: p === "all" ? "All" : PLATFORM_LABEL[p as Platform] }))}
          value={platform}
          onChange={setPlatform}
        />
      </div>
      {state.status === "loading" && <SkeletonBlocks />}
      {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      {data && (
        <div className="scr-split">
          <div className="scr-main">
            <Board drafts={data.drafts.filter((d) => d.kind === kind && (platform === "all" || d.platform === platform))} />
          </div>
          <Panel id="writer-your-voice"
            className="scr-side"
            title="Your voice"
            sub={
              <>
                What Writer uses right now. Learned from your edits; newer notes win.{" "}
                <a href="/app?doc=voice">Edit your voice →</a>
              </>
            }
          >
            <div className="scr-rows">
              {data.voice.lines.length === 0 && <p className="scr-row scr-muted">Writer learns your voice from what you change in its drafts.</p>}
              {data.voice.lines.map((line) => (
                <div key={line.text} className="scr-row">
                  <b className="scr-strong">{line.text}</b>
                  <span className="scr-small scr-muted">{line.source}</span>
                </div>
              ))}
              {data.voice.wordsCut.length > 0 && (
                <div className="scr-row">
                  <b className="scr-strong">Words you cut:</b>
                  <span className="scr-small scr-muted">{data.voice.wordsCut.join(", ")}</span>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </Screen>
  );
}

/** An approved script opens its blank edit, with a marker per beat (`/api/v1/cmo/scripts/[id]/open`). */
function OpenScript({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  async function open() {
    setState("busy");
    try {
      await openScript(orderId);
    } catch {
      setState("failed");
    }
  }
  return (
    <span className="td-row-cta">
      <Button variant="secondary" compact disabled={state === "busy"} onClick={() => void open()}>
        {state === "busy" ? "Opening…" : "Open in editor"}
      </Button>
      {state === "failed" && <span className="scr-tiny scr-muted"> Could not open it. Try again.</span>}
    </span>
  );
}

/** Waiting on you first: the feed leads with what needs the founder (canvas AgentWriter.dc.html). */
const LIST_ORDER = ["waiting", "drafting", "scheduled", "posted"] as const satisfies readonly (typeof WRITER_COLUMNS)[number][];
const KIND_ICON: Record<Kind, IconName> = { post: "message-circle", caption: "captions", video_brief: "video", slide_text: "layers" };
const KIND_ONE: Record<Kind, string> = { post: "Post", caption: "Caption", video_brief: "Video brief", slide_text: "Slide text" };
const BADGE: Record<(typeof WRITER_COLUMNS)[number], string> = { waiting: "is-waiting", drafting: "is-running", scheduled: "is-scheduled", posted: "is-posted" };

function Board({ drafts }: { drafts: Draft[] }) {
  if (drafts.length === 0) {
    return (
      <div className="v2-empty">
        <b className="v2-empty-title">Nothing here yet.</b>
        <span className="v2-empty-text">Writer drafts the week from your strategy every Sunday. Ask for a post to get one now.</span>
      </div>
    );
  }
  return (
    <div className="td-groups">
      {LIST_ORDER.map((column) => {
        const items = drafts.filter((d) => d.column === column);
        if (items.length === 0) return null;
        return (
          <section key={column} aria-label={COLUMN_LABEL[column]} className="td-group">
            <h2 className="td-group-head">
              {COLUMN_LABEL[column]} <span className="v2-num">{items.length}</span>
            </h2>
            <ul className="td-rows">
              {items.map((d) => {
                const meta = `${slotText(d)}${d.versions > 1 ? ` · ${d.versions} versions` : ""}`;
                const row = (
                  <>
                    <span className="td-row-tile" aria-hidden="true">
                      <Icon name={KIND_ICON[d.kind]} size={14} />
                    </span>
                    <span className="td-row-title">
                      <span className="td-row-kind">{KIND_ONE[d.kind]} · </span>
                      {d.title}
                      {d.note ? <span className="td-row-note">{d.note}</span> : null}
                    </span>
                    <span className={`v2-chip ${BADGE[column]}`}>{COLUMN_LABEL[column]}</span>
                    <span className="td-row-meta">{meta}</span>
                  </>
                );
                return (
                  <li key={d.id} className="td-row-item">
                    {column === "waiting" && d.approvalId ? (
                      <a href={`/app/inbox/${encodeURIComponent(d.approvalId)}`} className="td-row" aria-label={`Review: ${d.title}`}>
                        {row}
                        <span className="td-row-cta">Review</span>
                      </a>
                    ) : (
                      <div className="td-row">
                        {row}
                        {d.scriptId ? (
                          <>
                            <a className="v2-button is-quiet is-compact" href={`/app/script/${encodeURIComponent(d.scriptId)}/prompter`}>
                              <Icon name="smartphone" size={14} />
                              Read on your phone
                            </a>
                            <OpenScript orderId={d.scriptId} />
                          </>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
