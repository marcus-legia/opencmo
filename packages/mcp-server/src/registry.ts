/**
 * The shared contract of the MCP server (docs/mcp-agent-team-sessions.md, "Shared contracts").
 *
 * Both sessions add tools, prompts and resources only through `registerGroup`; the server
 * (`server.ts`) turns the registry into MCP. Changing a type here needs a "Requests" note.
 *
 * Additive to the contract (A1): `McpTool.price`, `McpResourceTemplate` and `McpGroup.toolsFor`
 * (tools whose list depends on the request, like the model catalog). A tool with
 * `costsCredits` must have `price`: the server, not the tool, runs the two-step price → confirm,
 * so `run` only ever receives what the user was quoted.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

import type { SupabaseClient } from "@/lib/api/handler";

export type { SupabaseClient };

/** What a tool returns: text and image content, `structuredContent`, `isError`. */
export type McpResult = CallToolResult;

export type McpToolContext = {
  /** RLS-bound client for the calling user. */
  supabase: SupabaseClient;
  userId: string;
};

/** The first step of a tool that costs credits: what the user is asked to agree to. */
export type McpQuote = {
  credits: number;
  /** One line per change, as the in-app approval card lists them. */
  lines: string[];
  /** What `run` receives once confirmed. Signed by the server; the client cannot change it. */
  prepared: unknown;
  /** Extra fields shown with the price (a storyboard, the model name). */
  details?: Record<string, unknown>;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  /**
   * The JSON Schema clients see, when the tool already has one (the Assistant's tool specs, built
   * from the editor-core op schemas). Default: `z.toJSONSchema(inputSchema)`. `inputSchema` still
   * validates every call.
   */
  inputJsonSchema?: Record<string, unknown>;
  outputSchema?: z.ZodType;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  /** true → the server enforces the two-step price → confirm. */
  costsCredits?: boolean;
  /**
   * Required with `costsCredits`: checks the input and prices it, spending nothing. A string is
   * a problem the model should fix (returned with `isError`).
   */
  price?: (input: unknown, ctx: McpToolContext) => Promise<McpQuote | string>;
  /** With `costsCredits`, `input` is the confirmed `McpQuote.prepared`, not the client's input. */
  run: (input: unknown, ctx: McpToolContext) => Promise<McpResult>;
};

export type McpPrompt = {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
  render: (args: Record<string, string>) => string;
};

export type McpResource = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType: "text/markdown";
  read: (ctx: McpToolContext) => Promise<string>;
};

/** A family of resources under one URI template, e.g. `opencmo://skills/mine/{name}`. */
export type McpResourceTemplate = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType: "text/markdown";
  list: (ctx: McpToolContext) => Promise<{ uri: string; name: string; description?: string }[]>;
  /** null: no such resource. */
  read: (uri: string, ctx: McpToolContext) => Promise<string | null>;
};

export type McpGroup = {
  tools?: McpTool[];
  /** Tools built per request (after the catalog is loaded); names must not clash with static ones. */
  toolsFor?: (ctx: McpToolContext) => Promise<McpTool[]>;
  prompts?: McpPrompt[];
  resources?: McpResource[];
  templates?: McpResourceTemplate[];
};

const tools = new Map<string, McpTool>();
const prompts = new Map<string, McpPrompt>();
const resources = new Map<string, McpResource>();
const templates: McpResourceTemplate[] = [];
const dynamic: ((ctx: McpToolContext) => Promise<McpTool[]>)[] = [];

function add<T>(map: Map<string, T>, key: string, value: T, kind: string): void {
  // Two groups with one name would shadow each other silently in the client; fail at start instead.
  if (map.has(key)) throw new Error(`MCP ${kind} "${key}" is registered twice.`);
  map.set(key, value);
}

export function registerGroup(group: McpGroup): void {
  for (const tool of group.tools ?? []) {
    if (tool.costsCredits && !tool.price) throw new Error(`MCP tool "${tool.name}" costs credits but has no price step.`);
    add(tools, tool.name, tool, "tool");
  }
  for (const prompt of group.prompts ?? []) add(prompts, prompt.name, prompt, "prompt");
  for (const resource of group.resources ?? []) add(resources, resource.uri, resource, "resource");
  templates.push(...(group.templates ?? []));
  if (group.toolsFor) dynamic.push(group.toolsFor);
}

/** Every tool for this request: static ones first, then each group's per-request tools. */
async function toolsFor(ctx: McpToolContext): Promise<McpTool[]> {
  const built = (await Promise.all(dynamic.map((build) => build(ctx)))).flat();
  for (const tool of built) {
    if (tools.has(tool.name)) throw new Error(`MCP tool "${tool.name}" is registered twice.`);
    if (tool.costsCredits && !tool.price) throw new Error(`MCP tool "${tool.name}" costs credits but has no price step.`);
  }
  return [...tools.values(), ...built];
}

/** What the server reads. Order is registration order: groups/index.ts decides it. */
export const registry = {
  tools: toolsFor,
  prompts: () => [...prompts.values()],
  prompt: (name: string) => prompts.get(name),
  resources: () => [...resources.values()],
  resource: (uri: string) => resources.get(uri),
  templates: () => [...templates],
};

/** Plain text content, the shape most tools return. */
export function textResult(value: unknown, isError = false): McpResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

/** A sentence for the model with `isError` (contract: errors the model should read). */
export const errorResult = (message: string): McpResult => textResult(message, true);
