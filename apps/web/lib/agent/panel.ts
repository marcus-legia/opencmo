/**
 * The CMO chat drives column 3 of the shell: a tool result may carry `view.open`, and the chat panel opens that
 * screen. The other way round, each turn says which screen the founder is looking at, so "make this one shorter"
 * has a referent.
 *
 * Pure module: the agent tools (server), the chat panel (client) and the check all import it. Screen paths come from
 * the rail's own table, so a screen the rail cannot open cannot be opened from the chat either.
 */

import { z } from "zod";

import { NAV_DEPARTMENTS, NAV_MAIN, NAV_MORE, NAV_SETTINGS, type ScreenName } from "@/components/shell-v2/nav";

const ENTRIES = [...NAV_MAIN, ...NAV_DEPARTMENTS, ...NAV_MORE, NAV_SETTINGS];

export const PANEL_SCREENS = ENTRIES.map((entry) => entry.screen).filter((screen): screen is ScreenName => screen !== null) as [ScreenName, ...ScreenName[]];

/**
 * The query key each screen keeps its tab in (`useTabParam`). The screen still checks the value against its own list
 * and falls back to its default, so a wrong tab opens the screen, never an error.
 */
const TAB_PARAM: Partial<Record<ScreenName, string>> = { library: "tab", brain: "tab", schedule: "view", studio: "kind", writer: "kind" };

export const PanelOpenSchema = z.object({
  screen: z.enum(PANEL_SCREENS),
  tab: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,23}$/)
    .optional(),
  /** Rows the tool just made or read (cards, runs, threads): the next turn's context, so "the second one" resolves. */
  ids: z.array(z.string().uuid()).max(20).optional(),
});
export type PanelOpen = z.infer<typeof PanelOpenSchema>;

/** Longest request the CMO chat hands to the clip Assistant; its own box takes 4000, the URL stays short. */
export const HANDOFF_PROMPT_MAX = 2000;

/**
 * The editor on one clip (plan 2026-11-02-cmo-chat-editor-handoff), with the founder's request for its Assistant.
 * `send`: the Assistant sends the request once the editor has loaded; otherwise it waits in the box.
 */
export const EditorOpenSchema = z.object({
  editor: z.object({
    clip_id: z.string().uuid(),
    prompt: z.string().trim().min(1).max(HANDOFF_PROMPT_MAX).optional(),
    send: z.boolean().optional(),
  }),
});
export type EditorOpen = z.infer<typeof EditorOpenSchema>;
export type PanelTarget = PanelOpen | EditorOpen;

/** The rows a target put on screen, for the next turn's context; the editor has its own Assistant, so none. */
export function targetIds(value: unknown): string[] {
  const parsed = PanelOpenSchema.safeParse(value);
  return parsed.success ? (parsed.data.ids ?? []) : [];
}

/** Returns null for anything that does not validate: a bad `view.open` must never move the founder's panel. */
export function panelHref(value: unknown): string | null {
  const editor = EditorOpenSchema.safeParse(value);
  if (editor.success) {
    const { clip_id, prompt, send } = editor.data.editor;
    const query = new URLSearchParams();
    if (prompt) query.set("ask", prompt);
    if (prompt && send) query.set("send", "1");
    const search = query.toString();
    return `/app/editor/${clip_id}${search ? `?${search}` : ""}`;
  }
  const parsed = PanelOpenSchema.safeParse(value);
  if (!parsed.success) return null;
  const { screen, tab } = parsed.data;
  const entry = ENTRIES.find((e) => e.screen === screen);
  if (!entry) return null;
  const key = TAB_PARAM[screen];
  return tab && key ? `${entry.href}?${key}=${tab}` : entry.href;
}

/** The screen a path under `/app` shows, by the rail's segments; null for the editor, setup and unknown pages. */
export function screenOfPath(pathname: string): ScreenName | null {
  const match = /^\/app(?:\/([^/?#]+))?/.exec(pathname);
  if (!match) return null;
  const segment = match[1] ?? null;
  return ENTRIES.find((entry) => entry.segments.includes(segment))?.screen ?? null;
}

/** What the chat sends with a turn: the screen in column 3 and the rows the last tool put there. */
export const ScreenContextSchema = z.object({
  name: z.enum(PANEL_SCREENS),
  ids: z.array(z.string().uuid()).max(20).optional(),
});
export type ScreenContext = z.infer<typeof ScreenContextSchema>;

/** The turn's context line. Ids are uuids and the name is from a fixed list, so nothing a stranger wrote gets in. */
export function screenContextText(context: ScreenContext | undefined): string {
  if (!context) return "";
  const ids = context.ids?.length ? `; the rows shown there: ${context.ids.join(", ")}` : "";
  return `<on_screen>The founder has the ${context.name} screen open next to the chat${ids}. "This" or "that one" means something on it.</on_screen>`;
}
