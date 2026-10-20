/**
 * Versions (editor-MCP plan, item 1): MCP has no undo; these list and restore the editor's Version history.
 * Bodies: `apps/web/lib/mcp/versions.ts`.
 */

import { listVersions, listVersionsInput, restoreVersion, restoreVersionInput, type VersionsAnswer } from "@/lib/mcp/versions";

import { errorResult, registerGroup, type McpResult } from "../registry";

const answer = (result: VersionsAnswer): McpResult =>
  result.ok ? { content: [{ type: "text", text: JSON.stringify(result.value) }], structuredContent: result.value } : errorResult(result.message);

registerGroup({
  tools: [
    {
      name: "list_versions",
      title: "List versions",
      description: "The saved versions of a clip (Version history), newest first: every MCP and Assistant checkpoint, every export, and whether the engine's original is there. Free.",
      inputSchema: listVersionsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(input, { supabase }) {
        return answer(await listVersions(supabase, (input as { clip_id: string }).clip_id));
      },
    },
    {
      name: "restore_version",
      title: "Restore a version",
      description: "Go back to a saved version (from list_versions) or the original. The current edit is kept as a version first, so a restore can be undone the same way. Use it when an edit went wrong; tell the user what you restored. Free.",
      inputSchema: restoreVersionInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      async run(input, { supabase }) {
        const { clip_id, version } = input as { clip_id: string; version: string };
        return answer(await restoreVersion(supabase, clip_id, version));
      },
    },
  ],
});
