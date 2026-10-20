/**
 * Look and listen (plan item 10): the in-app Assistant's browser tools, drawn on the worker for
 * clients with no browser. Same names and inputs as in the app where they exist (`capture` is
 * `capture_frame` here, the name the guides use over MCP), so guides and skills keep one
 * vocabulary. Bodies: `apps/web/lib/mcp/look.ts`.
 *
 * UNTESTED from a real client (2026-10-20): needs the deployed `look` endpoint (O4) and its two
 * secrets; see the note in `lib/mcp/look.ts`.
 */

import {
  captureFrameInput,
  inspectColorInput,
  mediaGrabInput,
  mediaWaveformInput,
  requestLook,
  type LookAnswer,
  type LookOp,
} from "@/lib/mcp/look";
import { saveFrame, saveFrameInput } from "@/lib/mcp/save-frame";

import { errorResult, registerGroup, type McpResult, type McpTool } from "../registry";

/** Images as MCP image content; the numbers as text (Claude Code reads `content`, not only `structuredContent`). */
function answer(result: LookAnswer): McpResult {
  if ("error" in result) return errorResult(result.error);
  return {
    content: [
      ...result.images.map((data) => ({ type: "image" as const, data, mimeType: "image/jpeg" })),
      { type: "text" as const, text: JSON.stringify(result.data) },
    ],
    structuredContent: result.data,
  };
}

const tool = (name: string, title: string, op: LookOp, description: string, inputSchema: McpTool["inputSchema"]): McpTool => ({
  name,
  title,
  description,
  inputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(input, { supabase, userId }) {
    return answer(await requestLook(supabase, userId, op, input as { clip_id: string }));
  },
});

registerGroup({
  tools: [
    tool(
      "capture_frame",
      "Look at the clip",
      "capture",
      "Look at the clip: frames at clip-timeline seconds drawn exactly as the export will, as one contact sheet with a timecode on each cell and thin cyan guides at 0.25/0.5/0.75 of the frame. " +
        "The result also lists, per frame, the visible layers top-first with their id and 0-1 box [x0, y0, x1, y1], so you can name exactly what you see. " +
        "Call it after changing the frame, cutting, adding text or media, and before you say you are done, to check framing, legibility and overlaps (half-cropped speaker, captions off-screen). Free, up to 12 frames a call.",
      captureFrameInput,
    ),
    tool(
      "inspect_color",
      "Measure the color",
      "inspect_color",
      "Measure the color of one frame as the export draws it (captions and text left out): black/white point, median luma, share of crushed and blown pixels, average RGB, saturation and a 16-bin luma histogram. " +
        "Use it before grading to see what to fix and after apply_color to check the result. element_id measures a single layer. Free.",
      inspectColorInput,
    ),
    tool(
      "media_grab",
      "Look inside a library file",
      "grab",
      "Look inside a library video or image before using it: frames at the given seconds of the file, as one contact sheet. Use it to choose which part of a B-roll file fits. Free.",
      mediaGrabInput,
    ),
    {
      name: "save_frame",
      title: "Save a frame",
      description:
        "Save one frame of the clip (as the export draws it, WITHOUT captions or text) to the library folder Frames, uploaded so generate_media can use it as start_image or end_image: " +
        "an AI transition between two shots (the frame before and after a cut), or a video that continues from a moment of the clip. Returns its library path and the picture. Free.",
      inputSchema: saveFrameInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async run(input, { supabase, userId }) {
        return answer(await saveFrame(supabase, userId, input as Parameters<typeof saveFrame>[2]));
      },
    },
    tool(
      "media_waveform",
      "Listen for loudness",
      "waveform",
      "Listen for loudness: coarse levels (dB, 60 columns) and the silent stretches of the clip's own video (SOURCE seconds as in get_transcript, ready for remove_ranges) or of a library file (seconds in that file). " +
        "Use it to find pauses the transcript does not show (breaths, noise, music). Free.",
      mediaWaveformInput,
    ),
  ],
});
