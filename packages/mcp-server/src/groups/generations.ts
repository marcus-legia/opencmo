/**
 * Polling for slow work (A5): a generation (AI media, explainer, video shot) runs for one to a few
 * minutes on the worker, longer than an MCP request may wait (Modal cuts at 150 s). The tool that
 * starts it returns `generation_id` at once; `get_generation` reads where it is. `wait_for_media`
 * (studio) waits up to 50 s for everything on a clip.
 */

import { z } from "zod";

import { GENERATION_COLUMNS, generationView, type GenerationRow } from "@/lib/generate/models";
import { signedObjectUrl } from "@/lib/storage";

import { errorResult, registerGroup } from "../registry";

const generationInput = z.object({ generation_id: z.string().uuid().describe("The id a generation tool returned.") });

const generationOutput = z.object({
  id: z.string(),
  clip_id: z.string().nullable(),
  kind: z.string(),
  model: z.string(),
  status: z.string(),
  credits: z.number().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  media: z.object({ name: z.string(), duration: z.number().nullable(), width: z.number().nullable(), height: z.number().nullable(), url: z.string() }).nullable(),
  next: z.string(),
});

const NEXT: Record<string, string> = {
  queued: "Waiting for the worker. Call get_generation again in about 30 seconds.",
  running: "Generating. Call get_generation again in about 30 seconds.",
  done: "Done: the media is on the clip. Give the user open_in_editor's link to watch it.",
  failed: "Failed; its credits were refunded. Tell the user the reason; try again only with a changed request.",
  cancelled: "Cancelled; its credits were refunded.",
};
// Cancelled after the worker sent the paid request: the credits stay spent (`credits` > 0).
const CANCELLED_SPENT = "Cancelled after it was sent; its credits were spent.";

registerGroup({
  tools: [
    {
      name: "get_generation",
      title: "Get a generation",
      description: "Where a generation is (queued, running, done, failed) with its credits, error and, when done, a download link to the file (valid for an hour). Poll every 20-30 seconds while it runs.",
      inputSchema: generationInput,
      outputSchema: generationOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { supabase }) {
        const { generation_id } = input as z.infer<typeof generationInput>;
        const { data } = await supabase.from("generations").select(GENERATION_COLUMNS).eq("id", generation_id).maybeSingle();
        if (!data) return errorResult("That generation was not found.");
        const view = generationView(data as GenerationRow);
        let media: z.infer<typeof generationOutput>["media"] = null;
        if (view.status === "done" && view.media_asset_id) {
          const { data: asset } = await supabase.from("media_assets").select("name, storage_path, duration, width, height").eq("id", view.media_asset_id).maybeSingle();
          if (asset) {
            const row = asset as { name: string; storage_path: string; duration: number | string | null; width: number | null; height: number | null };
            media = {
              name: row.name,
              duration: row.duration === null ? null : Number(row.duration),
              width: row.width,
              height: row.height,
              url: await signedObjectUrl("media", row.storage_path.replace(/^media\//, ""), { client: supabase }),
            };
          }
        }
        const result = {
          id: view.id,
          clip_id: view.clip_id,
          kind: view.kind,
          model: view.model,
          status: view.status,
          credits: view.credits === null || view.credits === undefined ? null : Number(view.credits),
          error: view.error,
          created_at: view.created_at,
          finished_at: view.finished_at,
          media,
          next: view.status === "cancelled" && view.credits ? CANCELLED_SPENT : (NEXT[view.status] ?? "Call get_generation again in a moment."),
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      },
    },
  ],
});
