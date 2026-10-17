/**
 * The `cmo` group — owned by Session B (docs/mcp-agent-team-sessions.md): the CMO chat's 20 tools, the CMO prompts and the skill resources.
 * The tools live with the CMO code in `apps/web/lib/cmo/mcp`.
 */

import { CMO_GROUP } from "@/lib/cmo/mcp";

import { registerGroup } from "../registry";

registerGroup(CMO_GROUP);
