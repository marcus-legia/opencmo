/**
 * Where the founder's Claude connects: the MCP server on Modal (`OPENCMO_MCP_URL`). null when it is
 * not configured, and the app then hides "Connect Claude": the old `/api/mcp` route only answers 410.
 */

export const mcpEndpoint = (env: NodeJS.ProcessEnv = process.env): string | null => env.OPENCMO_MCP_URL?.trim().replace(/\/$/, "") || null;
