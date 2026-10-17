/**
 * Where the founder's Claude connects: the MCP server on Modal (`OPENCMO_MCP_URL`). null when it is
 * not configured, and the app then hides "Connect Claude": the old `/api/mcp` route only answers 410.
 */

export const mcpEndpoint = (env: NodeJS.ProcessEnv = process.env): string | null => env.OPENCMO_MCP_URL?.trim().replace(/\/$/, "") || null;

/** The Claude Code command, with the founder's own key in place of `key`. */
export const claudeCodeCommand = (endpoint: string, key = "<your API key>"): string =>
  `claude mcp add --transport http opencmo ${endpoint} --header "Authorization: Bearer ${key}"`;
