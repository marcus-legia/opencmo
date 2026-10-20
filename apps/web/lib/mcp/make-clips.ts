/**
 * `make_clips` over MCP (plan item 5): the user's Claude suggests the moments, the human makes the
 * clips. The tool never creates a job. It checks the moments with the same rules as the picker and
 * `createClipJob` (`segmentProblem`) and returns the full-size picker link, pre-filled (contract
 * A1). The user then confirms the video is theirs and presses Make clips: an agent may not confirm
 * ownership for them (`lib/agent/prompt.ts`), and the credits are held only by that click.
 *
 * Links only: an upload has no transcript Claude could read before it is clipped.
 *
 * No `server-only`: the MCP server bundles it, and `packages/mcp-server/src/server.check.ts` runs it.
 */

import { z } from "zod";

import { sourceProblem } from "@/lib/api/source";
import { pickerPath, segmentProblem, MAX_SEGMENTS } from "@/lib/clipping/segments";
import { SITE_URL } from "@/lib/site";

export const makeClipsInput = z.object({
  url: z.string().trim().min(1).max(2000).describe("The user's own video link, e.g. their YouTube video."),
  segments: z
    .array(
      z.object({
        start: z.number().min(0).describe("Seconds into the video where the clip starts."),
        end: z.number().min(0).describe("Seconds into the video where the clip ends."),
      }),
    )
    .max(MAX_SEGMENTS)
    .describe("The moments to clip, 1-10, each 1-180 s, not overlapping. Each moment becomes one clip of that length."),
});

export const makeClipsOutput = z.object({
  picker_url: z.string(),
  moments: z.number(),
  message: z.string(),
});

export type MakeClipsResult = { ok: true; value: z.infer<typeof makeClipsOutput> } | { ok: false; message: string };

/** The web app's origin, where the user's browser opens the picker (never the MCP server). */
const webOrigin = () => (process.env.OPENCMO_WEB_URL ?? SITE_URL).replace(/\/+$/, "");

export function makeClips(input: z.infer<typeof makeClipsInput>, userId: string): MakeClipsResult {
  const url = input.url.trim();
  if (url.startsWith("storage://")) return { ok: false, message: "make_clips takes a video link. For an upload, the user picks the moments in the editor's Clips tab." };
  const source = sourceProblem(url, userId);
  if (source) return { ok: false, message: source };
  const problem = segmentProblem(input.segments);
  if (problem) return { ok: false, message: problem };
  const count = input.segments.length;
  return {
    ok: true,
    value: {
      picker_url: `${webOrigin()}${pickerPath({ source: url, segments: input.segments })}`,
      moments: count,
      message:
        `Give the user this link. It opens the clip picker with ${count} ${count === 1 ? "moment" : "moments"} filled in; ` +
        "they can adjust them, confirm the video is their own and press Make clips. No clips are made and no credits are spent until they do. " +
        "Link jobs need the download service, which can be unavailable; an upload always works.",
    },
  };
}
