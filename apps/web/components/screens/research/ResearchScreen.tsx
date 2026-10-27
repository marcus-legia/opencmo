"use client";

import { useState } from "react";

import { ButtonLink } from "@/components/ui";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import type { ResearchScreen as Data } from "@/lib/screens/research";

import { int } from "../format";
import { ErrorNote, PageHeader, Panel, Pills, Screen, SkeletonBlocks } from "../parts";
import { isSample, useScreen } from "../useScreen";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "competitors", label: "Competitors" },
  { id: "niche_video", label: "Niche video" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const TYPE_LABEL: Record<Data["insights"][number]["type"], string> = { hook: "Hook", format: "Format", idea: "Idea" };

function when(isoTime: string | null): string | null {
  if (!isoTime) return null;
  const d = new Date(isoTime);
  return `${d.toLocaleDateString("en-GB", { weekday: "long" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function ResearchScreen() {
  const [state] = useScreen("research");
  const data = state.status === "ready" ? state.data : null;
  const last = when(data?.lastRunAt ?? null);
  const next = data?.nextRunAt ? new Date(data.nextRunAt).toLocaleDateString("en-GB", { weekday: "long" }) : null;

  return (
    <Screen label="Research">
      <PageHeader
        numeral="I"
        eyebrow="Research"
        title="What works, with the link."
        sub={
          <>
            Every insight points to the post it came from.
            {last ? ` Last run: ${last}` : " Research runs every Sunday"}
            {next ? ` · next: ${next}.` : "."}
          </>
        }
        sample={state.status === "ready" && isSample(state.live)}
        actions={<ButtonLink href="/app/library?edit=competitors">Add a competitor</ButtonLink>}
      />
      <div className="scr-banner">
        <p className="scr-small">
          <b>Research drafted your 4 marketing documents.</b> They live in the Library now, where every department reads them.
        </p>
        <a href="/app/library" className="scr-mono-link">
          Open Library →
        </a>
      </div>
      {state.status === "loading" && <SkeletonBlocks />}
      {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      {data && <ResearchBody data={data} />}
    </Screen>
  );
}

function ResearchBody({ data }: { data: Data }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = data.insights.filter((i) => filter === "all" || i.scope === filter);

  return (
    <div className="scr-split">
      <Panel id="research-this-week-s-insights"
        className="scr-main"
        title="This week's insights"
        actions={<Pills label="Insight type" options={[...FILTERS]} value={filter} onChange={setFilter} />}
        foot={
          data.dropped > 0
            ? `${data.dropped} ${data.dropped === 1 ? "insight" : "insights"} dropped this week: no source link in the data read.`
            : undefined
        }
      >
        <div className="scr-rows">
          {shown.length === 0 && (
            <p className="scr-row scr-muted">
              {data.insights.length ? "Nothing of this type this week." : "No insights yet. Research reads your competitors and niche every Sunday."}
            </p>
          )}
          {shown.map((insight) => (
            <article key={insight.id} className="scr-insight">
              <span className="scr-mono is-small">
                {TYPE_LABEL[insight.type]} · {insight.platform}
              </span>
              <div>
                <b>{insight.text}</b>
                <span className="scr-small scr-muted">
                  {insight.evidence} · {insight.usedIn ?? "not used yet"}
                </span>
              </div>
              <span className="scr-insight-sources">
                {insight.sources.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="scr-mono-link">
                    {insight.sources.length === 1 ? "Source" : `Source ${i + 1}`} ↗
                  </a>
                ))}
              </span>
            </article>
          ))}
        </div>
      </Panel>
      <Panel id="research-your-results-24-h-after-posting" className="scr-side" title="Your results · 24 h after posting" foot="Results go to memory for Sunday's review.">
        {data.results.length ? (
          <div className="v2-table-wrap">
            <table className="v2-table scr-table-compact">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Views</th>
                  <th>Replies</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {PLATFORM_LABEL[r.platform]} · {r.title}
                    </td>
                    <td className="scr-num">{int(r.views)}</td>
                    <td className="scr-num">{int(r.replies)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="v2-panel-body scr-muted">Your posts show here a day after they go out.</p>
        )}
      </Panel>
    </div>
  );
}
