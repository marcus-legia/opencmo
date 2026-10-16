/**
 * The `account` group — owned by Session B (docs/mcp-agent-team-sessions.md): credits, who thinks right now, and the top-up message.
 * The tools live with the CMO code in `apps/web/lib/cmo/mcp`.
 */

import { ACCOUNT_GROUP } from "@/lib/cmo/mcp";

import { registerGroup } from "../registry";

registerGroup(ACCOUNT_GROUP);
