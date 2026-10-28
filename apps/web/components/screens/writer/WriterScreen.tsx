"use client";

import { useState } from "react";

import { ButtonLink, Tabs } from "@/components/ui";
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
  const [kind, setKind] = useTabParam<Kind>("kind", WRITER_KINDS, "post");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const data = state.status === "ready" ? state.data : null;
  const count = (k: Kind) => data?.drafts.filter((d) => d.kind === k).length ?? 0;

  return (
    <Screen label="Writer">
      <PageHeader
        numeral="II"
        eyebrow="Writer"
        title="Words, in your voice."
        sub="Posts, captions, video briefs and slide text. Drafts only: nothing goes out until you approve it."
        sample={state.status === "ready" && isSample(state.live)}
        actions={<ButtonLink href="/app?ask=1">Ask for a post</ButtonLink>}
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
                <a href="/app/library?tab=voice">Edit in Library →</a>
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

function Board({ drafts }: { drafts: Draft[] }) {
  return (
    <div className="scr-board-wrap">
      <div className="scr-board">
        {WRITER_COLUMNS.map((column) => {
          const items = drafts.filter((d) => d.column === column);
          return (
            <section key={column} aria-label={COLUMN_LABEL[column]} className={`scr-board-col is-${column}`}>
              <h2 className="scr-board-head">
                <span>{COLUMN_LABEL[column]}</span>
                <span>{items.length}</span>
              </h2>
              {items.map((d) => {
                const head = `${slotText(d)}${d.versions > 1 ? ` · ${d.versions} versions` : ""}`;
                const body = (
                  <>
                    <span className="scr-board-meta">{head}</span>
                    <span>{d.title}</span>
                    {d.note && <span className="scr-tiny scr-muted">{d.note}</span>}
                    {column === "waiting" && d.approvalId && <span className="scr-board-cta">Review →</span>}
                  </>
                );
                return column === "waiting" && d.approvalId ? (
                  <a key={d.id} href={`/app/inbox/${encodeURIComponent(d.approvalId)}`} className="scr-board-card">
                    {body}
                  </a>
                ) : (
                  <div key={d.id} className="scr-board-card">
                    {body}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
