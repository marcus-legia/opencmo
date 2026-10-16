/**
 * The shapes of Session A's MCP registry (`packages/mcp-server/src/registry.ts`, contract in
 * docs/mcp-agent-team-sessions.md), as far as the CMO, inbox and account groups use them. The
 * group files there register these objects as they are: a tool's `run` only needs the RLS client
 * and the user id, so it accepts the registry's full `McpToolContext`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

export type McpContent = { type: "text"; text: string };
export type McpResult = { content: McpContent[]; structuredContent?: Record<string, unknown>; isError?: boolean };

/** What these tools read from the registry's `McpToolContext`. */
export type CmoToolContext = { supabase: SupabaseClient; userId: string };

export type McpAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };

export type CmoMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  outputSchema?: z.ZodType;
  annotations: McpAnnotations;
  costsCredits?: boolean;
  run: (input: unknown, ctx: CmoToolContext) => Promise<McpResult>;
};

export type CmoMcpPrompt = {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; required?: boolean; description?: string }[];
  render: (args: Record<string, string>) => string;
};

export type CmoMcpResource = { uri: string; name: string; mimeType: "text/markdown"; read: (ctx: CmoToolContext) => Promise<string> };

export type CmoMcpGroup = { tools?: CmoMcpTool[]; prompts?: CmoMcpPrompt[]; resources?: CmoMcpResource[] };

/**
 * A result for the model. Clients may show the model only `structuredContent` when it is there
 * (Claude Code does), so it repeats the whole text as `message`: the fields are for programs,
 * the message is what the model must read.
 */
export const ok = (text: string, structured?: Record<string, unknown>): McpResult => ({
  content: [{ type: "text", text }],
  ...(structured ? { structuredContent: { message: text, ...structured } } : {}),
});

/** An error the model should read and act on: one English sentence. */
export const fail = (text: string): McpResult => ({ content: [{ type: "text", text }], isError: true });

/** zod's message for the first problem in an input, as a sentence. */
export function invalidInput(error: z.ZodError): McpResult {
  const issue = error.issues[0];
  return fail(`Invalid input${issue ? ` (${issue.path.join(".") || "input"}: ${issue.message})` : ""}.`);
}

/** A Supabase/RPC error message that is already written for the user, or a generic one. */
export function rpcMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  // Our RPCs raise P0001/P0002/22023 with English sentences meant for the user; anything else is internal.
  return error && error.message && ["P0001", "P0002", "22023"].includes(error.code ?? "") ? error.message : fallback;
}
