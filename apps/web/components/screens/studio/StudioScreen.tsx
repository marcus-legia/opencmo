"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "@/components/clipping/api";
import { NewMenu } from "@/components/editor/slides/NewMenu";
import { Icon } from "@/components/icons";
import { useShellState } from "@/components/shell-v2/ShellState";
import { Button, ButtonLink, EmptyState, SampleTag, Tabs } from "@/components/ui";
import type { ApprovedScript } from "@/app/api/v1/cmo/scripts/route";
import type { Project } from "@/lib/clipping-types";
import { STUDIO_KINDS, type StudioScreen as Data, type TeamStep } from "@/lib/screens/studio";

import { ErrorNote, PageHeader, Panel, Screen, SkeletonBlocks } from "../parts";
import { useTabParam } from "../useTabParam";
import { useScreen } from "../useScreen";
import { StudioCard, type CardActions } from "./StudioCard";
import { StudioDrawer } from "./StudioDrawer";
import { cutShorts, finishedNote, markFinished, type EditState } from "./finish";
import { SORTS, projectCard, screenCard, sortCards, type Card, type Sort } from "./model";
import { useProjects } from "./useProjects";

type Kind = (typeof STUDIO_KINDS)[number];
const TABS: { id: "all" | Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "short", label: "Shorts" },
  { id: "slideshow", label: "Slideshows" },
  { id: "post_image", label: "Post images" },
  { id: "upload", label: "Your uploads" },
];
type Tab = (typeof TABS)[number]["id"];

export function StudioScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useTabParam<Tab>("kind", TABS.map((t) => t.id), "all");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [favorites, setFavorites] = useState(false);
  const [sort, setSort] = useState<Sort>("edited");
  const [itemId, setItemId] = useState<string | null>(params.get("item"));
  const [error, setError] = useState<string | null>(null);
  const projects = useProjects(query);
  const [screen, reloadScreen] = useScreen("studio");
  const { toast } = useShellState();
  /** The edit a Mark finished or Cut shorts call is running for. */
  const [finishing, setFinishing] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"all" | "progress" | "finished">("all");

  // The search box lives in the URL (`?q=`), so coming back to Studio shows the same results.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [query]);

  const openItem = useCallback((id: string | null) => {
    setItemId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const sampleItems = screen.status === "ready" && !screen.live.items;
  // Sample edit states would put buttons for edits that do not exist on real uploads.
  const editStates = useMemo(
    () => new Map<string, EditState>(screen.status === "ready" && screen.live.editStates ? screen.data.editStates.map((e) => [e.clipId, e]) : []),
    [screen],
  );

  const finish = useCallback(
    async <T,>(clipId: string, run: () => Promise<T>, done: string | ((result: T) => string)) => {
      if (finishing) return;
      if (sampleItems && !editStates.has(clipId)) {
        toast(`${done} (sample, nothing was sent).`);
        return;
      }
      setFinishing(clipId);
      setError(null);
      try {
        const result = await run();
        toast(typeof done === "string" ? done : done(result));
        reloadScreen();
      } catch (err) {
        // A stale hash or an edit that is not finished: the server's sentence says what to do.
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        reloadScreen();
      } finally {
        setFinishing(null);
      }
    },
    [finishing, sampleItems, editStates, toast, reloadScreen],
  );
  const cards = useMemo(() => {
    const uploads = projects.projects.map(projectCard);
    const ids = new Set(uploads.map((c) => c.id));
    const generated =
      screen.status === "ready"
        ? screen.data.items
            // Uploads are read live from the projects API; the screens route's sample uploads would be duplicates.
            .filter((item) => !(sampleItems && item.kind === "upload") && !(item.projectId && ids.has(item.projectId)))
            .map(screenCard)
        : [];
    return [...uploads, ...generated];
  }, [projects.projects, screen, sampleItems]);

  const needle = query.trim().toLowerCase();
  const visible = sortCards(
    cards.filter(
      (c) =>
        (tab === "all" || c.kind === tab) &&
        (!favorites || c.favorite) &&
        (!needle || c.project || c.title.toLowerCase().includes(needle)),
    ),
    sort,
  );
  const count = (id: Tab) => cards.filter((c) => id === "all" || c.kind === id).length;
  const selected = itemId ? (cards.find((c) => c.id === itemId) ?? null) : null;

  const actions: CardActions = {
    open: (card) => openItem(card.id),
    openInEditor: (card) => {
      if (card.editorHref) {
        router.push(card.editorHref);
        return;
      }
      if (!card.project) return;
      // The list carries no clip ids (too heavy); read the one upload to find its edit.
      void api<Project>(`/projects/${encodeURIComponent(card.project.id)}`)
        .then((project) => {
          const clip = project.clips.find((c) => c.id);
          if (clip?.id) router.push(`/app/editor/${encodeURIComponent(clip.id)}`);
          else openItem(card.id);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not open the editor."));
    },
    toggleFavorite: (card) => card.project && void projects.toggleFavorite(card.project),
    rename: (card, title) => card.project && void projects.rename(card.project, title),
    retry: (card) => card.project && void projects.retry(card.project),
    cancel: (card) => card.project && void projects.cancel(card.project),
    remove: (card) => {
      if (!card.project) return;
      void projects.remove(card.project);
      if (itemId === card.id) openItem(null);
    },
    markFinished: (clipId, documentHash) => void finish(clipId, () => markFinished(clipId, documentHash), (done) => finishedNote(done).text),
    cutShorts: (clipId) => void finish(clipId, () => cutShorts(clipId), "Cutting 3 shorts. The batch card comes to your Dashboard"),
  };

  const STATE_FILTERS = [
    { id: "all", label: "All" },
    { id: "progress", label: "In progress" },
    { id: "finished", label: "Finished" },
  ] as const;
  const shownCards = visible.filter((c) =>
    stateFilter === "all" ? true : stateFilter === "finished" ? c.status === "finished" || c.status === "ready" : !(c.status === "finished" || c.status === "ready"),
  );
  const BADGE: Record<Card["status"], [string, string]> = {
    uploading: ["Uploading", "badge b-run"],
    processing: ["Transcribing", "badge b-run"],
    running: ["Being made", "badge b-run"],
    waiting_founder: ["Waits on you", "badge b-edit"],
    ready: ["Editing", "badge b-edit"],
    finished: ["Finished", "badge b-ok"],
    failed: ["Failed", "badge b-edit"],
    cancelled: ["Cancelled", "badge b-edit"],
  };

  // Projects.dc.html: the editor's home. Scripts to film first (the founder makes the videos), then the projects.
  return (
    <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "24px 24px 48px" }} data-testid="v2-studio">
      <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
        <div style={{ flex: "1 1 320px" }}>
          <h1 style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>Videos</h1>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "14px" }}>Film from the script, upload the take, fine-tune it here. Cut short clips from a finished video and Post schedules them.</p>
        </div>
        <span className="v2 td-newmenu">
          <NewMenu label="Blank edit" onOpen={(href) => router.push(href)} onError={setError} />
        </span>
        <Link href="/app/editor?panel=upload" className="primary" style={{ textDecoration: "none" }}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
          Upload a video
        </Link>
      </div>

      <ScriptsToFilm />

      {(error || projects.error) ? <p className="meta" role="alert">{error ?? projects.error}</p> : null}
      {sampleItems && cards.some((c) => !c.project) ? <p className="meta">Generated videos, shorts and slides below are sample data; your uploads are real.</p> : null}

      <div className="sec" style={{ flexWrap: "wrap" }}>
        <h2>Projects</h2>
        <span className="meta">{cards.length}</span>
        <div style={{ flex: "1 1 auto" }}></div>
        <label htmlFor="project-search" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Search videos, shorts, uploads
        </label>
        <input id="project-search" type="search" data-project-search placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="pill" style={{ width: "160px" }} />
        <div className="seg" role="tablist" aria-label="Filter projects">
          {STATE_FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={stateFilter === f.id} onClick={() => setStateFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {shownCards.length === 0 && projects.loaded ? (
        <p className="meta" role="status">
          {query.trim() ? "Nothing matches." : "Nothing here yet. Upload a video, or start a blank edit."}
        </p>
      ) : null}
      <div className="grid">
        {shownCards.map((p) => {
          const tall = p.kind === "short" || p.kind === "post_image";
          return (
            <button key={p.id} type="button" className="proj" onClick={() => actions.open(p)} style={{ textAlign: "left", font: "inherit", padding: "0", cursor: "pointer" }}>
              <span className="thumb" style={p.thumbnailUrl ? { backgroundImage: `url(${p.thumbnailUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
                {p.thumbnailUrl ? null : tall ? <span className="frame"></span> : <span className="wide"></span>}
                {p.subtitle.match(/\d+:\d{2}/) ? <span className="dur">{p.subtitle.match(/\d+:\d{2}/)![0]}</span> : null}
              </span>
              <span style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontWeight: "500", fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className={BADGE[p.status][1]}>{p.progress !== null && p.status !== "ready" && p.status !== "finished" ? `${BADGE[p.status][0]} ${Math.round(p.progress)}%` : BADGE[p.status][0]}</span>
                  <span className="meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.failure ?? p.subtitle}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {projects.hasMore ? (
        <div style={{ marginTop: "12px" }}>
          <button type="button" className="ghost" disabled={projects.loading} onClick={projects.loadMore}>
            {projects.loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}

      <div className="drop" style={{ marginTop: "20px" }}>
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "20px", height: "20px", color: "var(--muted)" }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ fontWeight: "500" }}>Drop your own video here</div>
          <div className="meta">Any video file, up to 15 minutes. It gets a transcript so you can cut by words.</div>
        </div>
        <Link href="/app/editor?panel=upload" className="ghost" style={{ textDecoration: "none" }}>
          Choose a file
        </Link>
      </div>

      <StudioDrawer
        card={selected}
        missing={itemId && !selected && projects.loaded && screen.status !== "loading" ? itemId : null}
        busy={!!selected && projects.busyId === selected.id}
        actions={actions}
        onClose={() => openItem(null)}
        onProject={projects.replace}
        editStates={editStates}
        finishing={finishing}
      />
    </div>
  );
}

function TeamPanel({ team, sample }: { team: NonNullable<Data["team"]>; sample: boolean }) {
  return (
    <Panel id="studio-video-team-now" className="scr-side" title={<>Video team · now {sample && <SampleTag />}</>} sub={team.title}>
      <TeamSteps steps={team.steps} />
    </Panel>
  );
}

/** The Video team's steps on one video: Studio's team panel and, compact, under a video order on Brain. */
export function TeamSteps({ steps, compact = false }: { steps: TeamStep[]; compact?: boolean }) {
  return (
    <ol className={compact ? "scr-team is-compact" : "scr-team"}>
      {steps.map((step, i) => (
        <li key={step.label} className={`is-${step.state}`}>
          <span className="scr-team-mark" aria-hidden="true">
            {step.state === "done" ? "✓" : step.state === "running" ? "" : i + 1}
          </span>
          <span>{step.label}</span>
          <span className="scr-sr-only">{step.state === "done" ? "done" : step.state === "running" ? "in progress" : "to do"}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Scripts the founder approved in Writer and still has to film (canvas Projects.dc.html): the founder makes the videos,
 * so the editor's home starts with what to record. Nothing shows when there is none.
 */
function ScriptsToFilm() {
  const [scripts, setScripts] = useState<ApprovedScript[]>([]);
  useEffect(() => {
    let alive = true;
    // A small list of its own: Studio does not load Writer's whole screen for it. No list rather than an error here.
    void api<{ scripts: ApprovedScript[] }>("/cmo/scripts")
      .then((r) => alive && setScripts(r.scripts))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (scripts.length === 0) return null;
  return (
    <>
      <div className="sec">
        <h2>Scripts to film</h2>
        <span className="meta">approved in Writer</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "28px" }}>
        {scripts.map((d) => {
          const total = d.beats.reduce((sum, b) => sum + b.seconds, 0);
          const camera = d.beats.filter((b) => b.shot === "talking_head").length;
          return (
            <div key={d.id} className="script">
              <span className="st">
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                  <rect x="2" y="6" width="14" height="12" rx="2" />
                </svg>
              </span>
              <div style={{ flex: "1 1 280px", minWidth: "0" }}>
                <div style={{ fontWeight: "500", fontSize: "14.5px" }}>{d.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                  <div className="beatbar" aria-hidden="true">
                    {d.beats.map((b, i) => (
                      <i key={i} style={{ width: `${Math.max(8, Math.round(b.seconds * 2.2))}px` }}></i>
                    ))}
                  </div>
                  <span className="meta">
                    {d.beats.length} beats · {total} s · {camera === d.beats.length ? "all to camera" : `${camera} to camera, ${d.beats.length - camera} screen`}
                  </span>
                </div>
              </div>
              <Link href={`/app/script/${encodeURIComponent(d.id)}/prompter`} className="ghost" style={{ textDecoration: "none" }}>
                <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                  <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                  <path d="M12 18h.01" />
                </svg>
                Read on your phone
              </Link>
              <Link href="/app/editor?panel=upload" className="primary" style={{ textDecoration: "none" }}>
                Upload the take
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}
