/**
 * The v2 rail (Main.dc.html). Each entry names the screen it opens, so the rail can hide a screen that is not live in
 * production instead of showing it as "coming soon".
 */

export type ScreenName =
  | "dashboard"
  | "analytics"
  | "brain"
  | "library"
  | "research"
  | "writer"
  | "studio"
  | "sales"
  | "schedule"
  | "settings";

/** Departments that can be stuck; the rail puts a red square next to them. */
export type DepartmentName = "research" | "writer" | "studio" | "sales" | "schedule" | "publish";

export type NavEntry = {
  /** Null for entries that are not a v2 screen (the editor) and are always shown. */
  screen: ScreenName | null;
  label: string;
  href: string;
  /** Layout segments under `app/app/` that light this entry. */
  segments: (string | null)[];
  department?: DepartmentName;
};

/** The Dashboard (the inbox, where every approval waits) leads. */
export const NAV_MAIN: NavEntry[] = [{ screen: "dashboard", label: "Dashboard", href: "/app", segments: [null, "inbox"] }];

/**
 * The CMO loop in the owner's order (cmo-review-2 §2.1): Writer writes, Studio builds from the approved words, Schedule
 * posts. Sales runs beside the loop.
 */
export const NAV_DEPARTMENTS: NavEntry[] = [
  { screen: "writer", label: "Writer", href: "/app/writer", segments: ["writer"], department: "writer" },
  { screen: "studio", label: "Studio", href: "/app/studio", segments: ["studio", "projects", "jobs"], department: "studio" },
  { screen: "schedule", label: "Schedule", href: "/app/schedule", segments: ["schedule"], department: "schedule" },
  { screen: "sales", label: "Sales", href: "/app/sales", segments: ["sales"], department: "sales" },
];

/** Reachable, but they do not lead: the business documents and Brand Kit, research, numbers and memory. */
export const NAV_MORE: NavEntry[] = [
  { screen: "library", label: "Library", href: "/app/library", segments: ["library", "brand"] },
  { screen: "research", label: "Research", href: "/app/research", segments: ["research"], department: "research" },
  { screen: "analytics", label: "Analytics", href: "/app/analytics", segments: ["analytics"] },
  { screen: "brain", label: "Brain", href: "/app/brain", segments: ["brain"] },
];

export const NAV_SETTINGS: NavEntry = { screen: "settings", label: "Settings", href: "/app/settings", segments: ["settings", "billing"] };

export const isCurrent = (entry: NavEntry, segment: string | null) => entry.segments.includes(segment);
