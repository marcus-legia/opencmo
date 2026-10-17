/**
 * Export (A6): `export_clip` (studio, the Assistant's `request_export` behind price → confirm)
 * starts one render per frame and returns their task ids; `get_export` reads one and, when done,
 * signs a download link. Exports cost no credits but use the plan's daily exports.
 */

import { z } from "zod";

import { taskById, taskWithUrl } from "@/lib/api/tasks";

import { errorResult, registerGroup } from "../registry";

const exportInput = z.object({ export_id: z.string().uuid().describe("A task_id export_clip returned.") });

const exportOutput = z.object({
  id: z.string(),
  status: z.string(),
  clip_id: z.string().nullable(),
  progress: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  bytes: z.number().nullable(),
  error: z.string().nullable(),
  download_url: z.string().nullable(),
  next: z.string(),
});

registerGroup({
  tools: [
    {
      name: "get_export",
      title: "Get an export",
      description: "Where an export is (queued, running with progress 0-1, done, failed) and, when done, a download link for the MP4 (valid for 5 minutes: give it to the user right away, or call again for a fresh one). Poll every 20-30 seconds while it renders.",
      inputSchema: exportInput,
      outputSchema: exportOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { supabase }) {
        const { export_id } = input as z.infer<typeof exportInput>;
        const raw = await taskById(supabase, export_id).catch(() => null);
        if (!raw || raw.kind !== "render_document") return errorResult("That export was not found.");
        const task = await taskWithUrl(raw, { client: supabase });
        const result = {
          id: task.id,
          status: task.status,
          clip_id: task.clip_id,
          progress: task.progress,
          width: task.width,
          height: task.height,
          bytes: task.bytes,
          error: task.error,
          download_url: task.url,
          next:
            task.status === "done"
              ? "Give the user the download link; they post the file themselves."
              : task.status === "failed" || task.status === "cancelled"
                ? "The export did not finish. Tell the user the reason."
                : "Rendering. Call get_export again in about 30 seconds.",
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      },
    },
  ],
});
