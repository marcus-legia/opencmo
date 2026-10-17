/**
 * The `inbox` group — owned by Session B (docs/mcp-agent-team-sessions.md): the CMO work the schedule left for the founder's Claude.
 * The tools live with the CMO code in `apps/web/lib/cmo/mcp`.
 */

import { INBOX_GROUP } from "@/lib/cmo/mcp";

import { registerGroup } from "../registry";

registerGroup(INBOX_GROUP);
