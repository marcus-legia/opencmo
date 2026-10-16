/**
 * Session B's MCP groups, ready for `registerGroup()` in `packages/mcp-server/src/groups/
 * {cmo,inbox,account}.ts`.
 */

import { ACCOUNT_TOOLS } from "./account";
import { CMO_TOOLS } from "./cmo";
import type { CmoMcpGroup } from "./contract";
import { INBOX_TOOLS } from "./inbox";
import { CMO_PROMPTS, CMO_RESOURCES } from "./prompts";

export const CMO_GROUP: CmoMcpGroup = { tools: CMO_TOOLS, prompts: CMO_PROMPTS, resources: CMO_RESOURCES };
export const INBOX_GROUP: CmoMcpGroup = { tools: INBOX_TOOLS };
export const ACCOUNT_GROUP: CmoMcpGroup = { tools: ACCOUNT_TOOLS };

export { mediaCreditsShort } from "./account";
export type { CmoMcpGroup, CmoMcpPrompt, CmoMcpResource, CmoMcpTool, CmoToolContext, McpResult } from "./contract";
