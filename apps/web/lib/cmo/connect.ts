/**
 * Where an MCP client connects to the editor: the MCP server on Modal (`OPENCMO_MCP_URL`). null when it is not
 * configured, and Settings then shows no endpoint: the old `/api/mcp` route only answers 410.
 */

export const mcpEndpoint = (env: NodeJS.ProcessEnv = process.env): string | null => env.OPENCMO_MCP_URL?.trim().replace(/\/$/, "") || null;
