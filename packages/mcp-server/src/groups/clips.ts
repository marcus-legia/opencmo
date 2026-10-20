/**
 * Clips: `make_clips`, the pre-filled picker link for the user's own video (plan item 5). The body
 * lives in the web app (`lib/mcp/make-clips.ts`) next to the moment rules it shares with the picker.
 *
 * UNTESTED (2026-10-20): not yet called from claude.ai or Claude Code against a deployed server
 * (needs O4's `modal deploy mcp_app.py`). `server.check.ts` covers the tool through `callTool`; the
 * picker side of the link is covered by `e2e/editor-clipping.spec.ts` only for the empty `?panel=clips`
 * case, not for a link opened with `source=…&segments=…` (needs a playable YouTube embed in e2e).
 */

import { makeClips, makeClipsInput, makeClipsOutput } from "@/lib/mcp/make-clips";

import { errorResult, registerGroup } from "../registry";

registerGroup({
  tools: [
    {
      name: "make_clips",
      title: "Make clips (picker link)",
      description:
        "Prepare clips from the user's own video link: you pick the moments (read the transcript first, e.g. with get_video_transcript), " +
        "this returns a link to OpenCMO's clip picker with those moments filled in. It creates nothing and costs nothing: the user opens the link, " +
        "adjusts the moments, confirms the video is theirs and presses Make clips. Never say the clips are made; say they are ready to make. " +
        "Each moment becomes one clip of that length (1-180 s, up to 10, no overlap). Links only; link jobs need the download service, so suggest an upload if one fails.",
      inputSchema: makeClipsInput,
      outputSchema: makeClipsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { userId }) {
        const result = makeClips(input as Parameters<typeof makeClips>[0], userId);
        if (!result.ok) return errorResult(result.message);
        return { content: [{ type: "text", text: JSON.stringify(result.value) }], structuredContent: result.value };
      },
    },
  ],
});
