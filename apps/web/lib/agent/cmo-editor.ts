/**
 * CMO chat → editor handoff (docs/plans/cmo/2026-11-02-cmo-chat-editor-handoff-plan.md). The CMO chat finds the
 * founder's video, or starts a New edit, and opens the editor in column 3 with the request already in the clip
 * Assistant's box; the clip Assistant does the video work with its own tools and price cards. No clip tool runs here.
 *
 * Hidden from MCP, which has its own `find`, `export` and `versions` groups over the same reads.
 */
import { z } from "zod";

import type { SupabaseClient } from "@/lib/api/handler";
import { taskWithUrl, TASK_COLUMNS, type RawTask } from "@/lib/api/tasks";
import { clipExists, findClips, findProjects } from "@/lib/editor/find";
import { listVersions } from "@/lib/mcp/versions";

import { HANDOFF_PROMPT_MAX, type EditorOpen } from "./panel";
import type { ToolOutcome, ToolSpec } from "./tools";

export const EDITOR_TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_projects",
    description:
      "List the founder's videos: their uploads (projects, each edited as one clip) and their New edits (blank edits for AI videos and explainers), newest first, at most 20 of each. Use it when the founder asks about their videos or wants video work done, to find the clip to open with open_editor.",
    schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words in the video's name, to narrow the list." } },
      additionalProperties: false,
    },
    strict: false,
  },
  {
    name: "list_clips",
    description: "The clip of one project from list_projects (an upload is one editable clip): its id, hook and length. Pass the clip id to open_editor, get_export or list_versions.",
    schema: {
      type: "object",
      properties: { project_id: { type: "string", description: "A project id from list_projects." } },
      required: ["project_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "open_editor",
    description: [
      "Hand video work to the editor: opens the editor next to the chat on one clip, or on a new blank edit, with the founder's request typed into the editor's Assistant, which sends it and does the work there (cuts, captions, B-roll, generated shots, export).",
      "Use it for any request to make or change a video. Pass clip_id for one of their videos, or new_edit for something new (an AI video or an explainer). prompt is the founder's request, in their words, with what you know (the angle, the audience); leave it out to only open the clip.",
      "You cannot edit video yourself; after this, tell the founder the editor's Assistant is on it.",
    ].join(" "),
    schema: {
      type: "object",
      properties: {
        clip_id: { type: "string", description: "A clip id from list_clips or a New edit's clip_id from list_projects." },
        new_edit: {
          type: "object",
          description: "Start a blank edit instead of opening a clip.",
          properties: {
            name: { type: "string", description: "A short name, e.g. the video's title." },
            aspect: { type: "string", enum: ["9:16", "1:1", "16:9"] },
            kind: { type: "string", enum: ["video", "slideshow"], description: "slideshow: an edit made of slides." },
          },
          additionalProperties: false,
        },
        prompt: { type: "string", description: `The request for the editor's Assistant, up to ${HANDOFF_PROMPT_MAX} characters.` },
      },
      additionalProperties: false,
    },
    strict: false,
  },
  {
    name: "get_export",
    description: "Whether the latest export of a clip is ready (queued, rendering with progress, done, failed) and, when done, its size and a download link valid for 5 minutes. For \"is my video ready?\".",
    schema: {
      type: "object",
      properties: { clip_id: { type: "string" } },
      required: ["clip_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "list_versions",
    description: "The saved versions of a clip, newest first. Restoring one happens in the editor: open it with open_editor and say which version to go back to.",
    schema: {
      type: "object",
      properties: { clip_id: { type: "string" } },
      required: ["clip_id"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const EDITOR_TOOLS = new Set(EDITOR_TOOL_SPECS.map((spec) => spec.name));

const projectsInput = z.object({ query: z.string().trim().max(200).optional() });
const clipInput = z.object({ clip_id: z.string().uuid() });
const projectInput = z.object({ project_id: z.string().uuid() });
const openInput = z
  .object({
    clip_id: z.string().uuid().optional(),
    new_edit: z.object({ name: z.string().trim().max(120).optional(), aspect: z.enum(["9:16", "1:1", "16:9"]).optional(), kind: z.enum(["video", "slideshow"]).optional() }).optional(),
    prompt: z.string().trim().min(1).max(HANDOFF_PROMPT_MAX).optional(),
  })
  .refine((value) => Boolean(value.clip_id) !== Boolean(value.new_edit), "Pass clip_id or new_edit, not both.");

const invalid = (message: string): ToolOutcome => ({ ok: false, content: JSON.stringify({ INVALID_INPUT: message }), summary: "Invalid request" });
const failed = (message: string, summary: string): ToolOutcome => ({ ok: false, content: JSON.stringify({ error: message }), summary });
/** Names are the founder's own words or a stranger's upload title: data, not instructions. */
const data = (value: unknown) => JSON.stringify({ untrusted_data: value });

/** A new edit is a write (it creates a project); opening an existing clip only moves the panel. */
export const isEditorWrite = (name: string, input: unknown) => name === "open_editor" && Boolean((input as { new_edit?: unknown } | null)?.new_edit);

/** `send` is the owner's default (2026-11-02): the founder asked in the chat, so the editor's Assistant sends it. */
function opened(clipId: string, prompt: string | undefined): EditorOpen {
  return { editor: { clip_id: clipId, ...(prompt ? { prompt, send: true } : {}) } };
}

export async function runEditorTool(supabase: SupabaseClient, name: string, input: unknown): Promise<ToolOutcome> {
  switch (name) {
    case "list_projects": {
      const parsed = projectsInput.safeParse(input ?? {});
      if (!parsed.success) return invalid("query must be at most 200 characters.");
      const found = await findProjects(supabase, parsed.data.query, { projects: 20, edits: 20 });
      if (!found) return failed("Could not load the videos. Try again in a moment.", "Could not read");
      const count = found.projects.length + found.edits.length;
      return { ok: true, content: data(found), summary: count ? `Found ${count} ${count === 1 ? "video" : "videos"}` : "No videos yet" };
    }
    case "list_clips": {
      const parsed = projectInput.safeParse(input);
      if (!parsed.success) return invalid("project_id must be a project id from list_projects.");
      const clips = await findClips(supabase, parsed.data.project_id);
      if (!clips) return failed("Could not load the clips. Try again in a moment.", "Could not read");
      if (!clips.length) return failed("No clips in that project. Use list_projects to find its id.", "Project not found");
      return { ok: true, content: data({ clips }), summary: `Read ${clips.length} ${clips.length === 1 ? "clip" : "clips"}` };
    }
    case "open_editor": {
      const parsed = openInput.safeParse(input ?? {});
      if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? `Pass clip_id or new_edit; prompt up to ${HANDOFF_PROMPT_MAX} characters.`);
      const { clip_id, new_edit, prompt } = parsed.data;
      if (clip_id) {
        if (!(await clipExists(supabase, clip_id))) return failed("That clip was not found. Use list_projects and list_clips to find its id.", "Clip not found");
        return { ok: true, content: JSON.stringify({ opened: clip_id, sent: Boolean(prompt) }), summary: "Opened the editor", view: { open: opened(clip_id, prompt) } };
      }
      // The same limit and RPC as the editor's New edit button (`POST /api/v1/editor/new`).
      const { data: allowed, error: limited } = await supabase.rpc("rate_limit_hit", { p_bucket: "project-write", p_limit: 60, p_window_seconds: 3600 });
      if (limited) return failed("Could not start the edit. Try again in a moment.", "Could not start");
      if (allowed === false) return failed("You have started many edits in the last hour. Try again later.", "Too many new edits");
      const kind = new_edit!.kind ?? "video";
      const { data: clipId, error } = await supabase.rpc(kind === "slideshow" ? "create_slideshow" : "create_blank_edit", { p_name: new_edit!.name ?? null, p_aspect: new_edit!.aspect ?? "9:16" });
      if (error || typeof clipId !== "string") return failed(error?.code === "P0001" ? error.message : "Could not start the edit. Try again in a moment.", "Could not start");
      return { ok: true, content: JSON.stringify({ created: clipId, sent: Boolean(prompt) }), summary: "Started a new edit", view: { open: opened(clipId, prompt) } };
    }
    case "get_export": {
      const parsed = clipInput.safeParse(input);
      if (!parsed.success) return invalid("clip_id must be a clip id.");
      const { data: row, error } = await supabase
        .from("tasks")
        .select(TASK_COLUMNS)
        .eq("clip_id", parsed.data.clip_id)
        .eq("kind", "render_document")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return failed("Could not read the exports. Try again in a moment.", "Could not read");
      if (!row) return { ok: true, content: JSON.stringify({ exported: false, next: "No export yet. Open the editor with open_editor to export it." }), summary: "No export yet" };
      const task = await taskWithUrl(row as unknown as RawTask, { client: supabase });
      return {
        ok: true,
        content: JSON.stringify({ status: task.status, progress: task.progress, width: task.width, height: task.height, seconds: task.duration, bytes: task.bytes, error: task.error, download_url: task.url }),
        summary: task.status === "done" ? "Export ready" : task.status === "failed" ? "Export failed" : "Export rendering",
      };
    }
    case "list_versions": {
      const parsed = clipInput.safeParse(input);
      if (!parsed.success) return invalid("clip_id must be a clip id.");
      const result = await listVersions(supabase, parsed.data.clip_id);
      if (!result.ok) return failed(result.message, "Clip not found");
      // Restoring writes the edit; it happens in the editor, where the founder sees it.
      return { ok: true, content: data({ ...result.value, message: "To go back to one, open the editor with open_editor and ask its Assistant to restore that version." }), summary: "Read the versions" };
    }
    default:
      throw new Error(`Not an editor handoff tool: ${name}`);
  }
}
