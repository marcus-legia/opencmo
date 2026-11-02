import { stageLabel } from "@/components/clipping/ProcessingView";
import type { Project } from "@/lib/clipping-types";
import type { StudioItem } from "@/lib/screens/studio";

/**
 * One card on the Studio grid. Uploads come from today's projects API (live now); generated media
 * comes from the screens route (sample until its loader lands). Both render through this shape.
 */
export type Card = StudioItem & {
  /** Set for uploads: the row behind the card, for rename, delete, retry and cancel. */
  project: Project | null;
  thumbnailUrl: string | null;
  /** The upload's file name, searched along with the title. */
  sourceName: string | null;
};

function clock(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

const STATUS: Record<Project["status"], StudioItem["status"]> = {
  queued: "processing",
  running: "processing",
  done: "ready",
  failed: "failed",
  cancelled: "cancelled",
};

export function projectCard(project: Project): Card {
  const status = STATUS[project.status];
  const length = project.duration ? ` · ${clock(project.duration)}` : "";
  const subtitle =
    status === "processing"
      ? `Your upload · ${stageLabel(project)}`
      : status === "ready"
        ? `Your upload${length}`
        : status === "cancelled"
          ? "Your upload · processing was cancelled"
          : "Your upload";
  return {
    id: project.id,
    kind: "upload",
    title: project.title || project.source_name || "Your video",
    subtitle,
    status,
    progress: null,
    favorite: project.favorite,
    createdAt: project.created_at,
    editedAt: project.finished_at,
    failure: status === "failed" ? project.error || "We couldn't finish this video." : null,
    projectId: project.id,
    editorHref: null,
    approvalId: null,
    // Marking an edit finished needs its own route (Shorts are cut only from finished edits); not built yet.
    canMarkFinished: false,
    edits: [],
    project,
    thumbnailUrl: project.thumbnail_url ?? null,
    sourceName: project.source_name,
  };
}

export function screenCard(item: StudioItem): Card {
  return { ...item, project: null, thumbnailUrl: null, sourceName: null };
}

export const SORTS = [
  { id: "edited", label: "Last edited" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "Name" },
] as const;
export type Sort = (typeof SORTS)[number]["id"];

export function sortCards(cards: Card[], sort: Sort): Card[] {
  const by = {
    edited: (a: Card, b: Card) => (b.editedAt ?? b.createdAt).localeCompare(a.editedAt ?? a.createdAt),
    newest: (a: Card, b: Card) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a: Card, b: Card) => a.createdAt.localeCompare(b.createdAt),
    name: (a: Card, b: Card) => a.title.localeCompare(b.title),
  }[sort];
  return [...cards].sort(by);
}
