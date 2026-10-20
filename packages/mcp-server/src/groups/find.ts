/**
 * Find: the user's projects and clips, and the link that opens a clip in the editor.
 */

import { z } from "zod";

import { SITE_URL } from "@/lib/site";

import { errorResult, registerGroup, type McpResult } from "../registry";

const projectsInput = z.object({ query: z.string().trim().max(200).optional().describe("Words in the project name.") });
const clipsInput = z.object({ project_id: z.string().uuid().describe("A project id from list_projects.") });
const openInput = z.object({ clip_id: z.string().uuid().describe("The clip to open (from list_clips).") });
const newEditInput = z.object({
  name: z.string().trim().max(120).optional().describe("A name for the edit, e.g. the explainer's title."),
  aspect: z.enum(["9:16", "1:1", "16:9"]).optional().describe("The frame; default 9:16."),
});

const projectsOutput = z.object({
  projects: z.array(z.object({ id: z.string(), name: z.string().nullable(), status: z.string(), created_at: z.string() })),
  edits: z.array(z.object({ clip_id: z.string(), name: z.string().nullable(), aspect: z.string().nullable(), created_at: z.string(), editor_url: z.string() })),
});
const clipsOutput = z.object({
  clips: z.array(
    z.object({ id: z.string(), number: z.number(), hook: z.string().nullable(), kind: z.string().nullable(), seconds: z.number(), editor_url: z.string() }),
  ),
});
const openOutput = z.object({ url: z.string() });
const newEditOutput = z.object({ clip_id: z.string(), editor_url: z.string() });

/** Text for clients that only read content, the same object as structured output. */
const structured = <T extends Record<string, unknown>>(value: T): McpResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

/** Where the user's browser opens a clip: the web app, never this server. */
export const editorUrl = (clipId: string) => `${(process.env.OPENCMO_WEB_URL ?? SITE_URL).replace(/\/+$/, "")}/app/editor/${clipId}`;

registerGroup({
  tools: [
    {
      name: "list_projects",
      title: "List projects",
      description:
        "List the user's video projects (each one video they uploaded, edited as one clip), and their New edits (blank edits for AI videos and explainers, each one clip), newest first.",
      inputSchema: projectsInput,
      outputSchema: projectsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { supabase }) {
        const { query } = input as z.infer<typeof projectsInput>;
        const [{ data, error }, blank] = await Promise.all([
          supabase.rpc("list_projects", { p_query: query || null, p_limit: 50 }),
          // New edits are not projects in the app's list; under RLS this reads only the user's own.
          supabase.from("clips").select("id, hook, created_at, jobs!inner(kind, aspect, title)").eq("kind", "blank").eq("jobs.kind", "edit").order("created_at", { ascending: false }).limit(20),
        ]);
        if (error) return errorResult("Could not load your projects. Please try again.");
        const rows = (data ?? []) as { id: string; name: string | null; title: string | null; status: string; created_at: string }[];
        const edits = ((blank.data ?? []) as unknown as { id: string; hook: string | null; created_at: string; jobs: { aspect: string | null; title: string | null } }[])
          .filter((clip) => !query || `${clip.jobs.title ?? clip.hook ?? ""}`.toLowerCase().includes(query.toLowerCase()))
          .map((clip) => ({ clip_id: clip.id, name: clip.jobs.title ?? clip.hook, aspect: clip.jobs.aspect, created_at: clip.created_at, editor_url: editorUrl(clip.id) }));
        return structured({ projects: rows.map((job) => ({ id: job.id, name: job.name ?? job.title, status: job.status, created_at: job.created_at })), edits });
      },
    },
    {
      name: "list_clips",
      title: "List clips",
      description: "List the clip of a project (an upload becomes one editable clip): id, number, hook, kind and length. Every clip tool takes one of these ids as clip_id.",
      inputSchema: clipsInput,
      outputSchema: clipsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { supabase }) {
        const { project_id } = input as z.infer<typeof clipsInput>;
        const { data, error } = await supabase.from("clips").select("id, idx, hook, start_seconds, end_seconds, kind").eq("job_id", project_id).order("idx");
        if (error) return errorResult("Could not load the clips. Please try again.");
        return structured({
          clips: (data ?? []).map((clip) => ({
            id: clip.id as string,
            number: (clip.idx as number) + 1,
            hook: (clip.hook as string | null) ?? null,
            kind: (clip.kind as string | null) ?? null,
            seconds: Math.round((Number(clip.end_seconds) - Number(clip.start_seconds)) * 10) / 10,
            editor_url: editorUrl(clip.id as string),
          })),
        });
      },
    },
    {
      name: "new_edit",
      title: "New edit",
      description: "Start a blank New edit (one empty clip in the chosen frame) for a whole AI video (create_video) or an explainer, when the user wants something new rather than an edit of one of their clips. Free.",
      inputSchema: newEditInput,
      outputSchema: newEditOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async run(input, { supabase }) {
        const { name, aspect } = input as z.infer<typeof newEditInput>;
        // Same limit as the editor's New edit button (`POST /api/v1/editor/new`).
        const { data: allowed, error: limited } = await supabase.rpc("rate_limit_hit", { p_bucket: "project-write", p_limit: 60, p_window_seconds: 3600 });
        if (limited) return errorResult("Could not start the edit. Please try again.");
        if (allowed === false) return errorResult("You have created many edits in the last hour. Try again later.");
        const { data, error } = await supabase.rpc("create_blank_edit", { p_name: name ?? null, p_aspect: aspect ?? "9:16" });
        if (error || typeof data !== "string") return errorResult(error?.message && error.code === "P0001" ? error.message : "Could not start the edit. Please try again.");
        return structured({ clip_id: data, editor_url: editorUrl(data) });
      },
    },
    {
      name: "open_in_editor",
      title: "Open in the editor",
      description: "The link that opens a clip in the OpenCMO editor, to give the user so they can watch, adjust, export or publish it themselves.",
      inputSchema: openInput,
      outputSchema: openOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { supabase }) {
        const { clip_id } = input as z.infer<typeof openInput>;
        // Under RLS: someone else's clip id reads as not found.
        const { data } = await supabase.from("clips").select("id").eq("id", clip_id).maybeSingle();
        if (!data) return errorResult("That clip was not found. Use list_clips to find its id.");
        return structured({ url: editorUrl(clip_id) });
      },
    },
  ],
});
