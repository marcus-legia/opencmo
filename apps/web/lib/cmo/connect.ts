/**
 * Where the founder's Claude connects. The MCP server moves to Modal (docs/mcp-on-modal-plan.md);
 * until then it is the web app's own `/api/mcp`.
 */

import { SITE_URL } from "@/lib/site";

export const mcpEndpoint = (env: NodeJS.ProcessEnv = process.env): string => (env.OPENCMO_MCP_URL?.trim() || `${SITE_URL}/api/mcp`).replace(/\/$/, "");

/** The Claude Code command, with the founder's own key in place of `key`. */
export const claudeCodeCommand = (endpoint: string, key = "<your API key>"): string =>
  `claude mcp add --transport http opencmo ${endpoint} --header "Authorization: Bearer ${key}"`;
