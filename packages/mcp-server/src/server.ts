/**
 * The MCP server: the registry turned into MCP with the official SDK.
 *
 * Stateless: every POST builds a fresh `Server` + transport for the calling user and answers with
 * JSON, so any container of `opencmo-mcp` can take any request and nothing survives between them.
 * What must survive (a price the user saw, a preview that was looked at) travels in signed codes
 * (`confirm.ts`).
 *
 * Price → confirm is enforced here for every tool with `costsCredits`: without `confirm` the
 * tool's `price` runs and nothing is spent; with it, `run` gets the signed `prepared` value, never
 * the client's arguments, and each code works once (`mcp_confirm_use`). Claude's own
 * tool-approval prompt is not the approval.
 */

import { randomUUID } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";

import { ConfirmError, read, sign } from "./confirm";
import "./groups/index";
import { errorResult, registry, type McpQuote, type McpResult, type McpTool, type McpToolContext } from "./registry";

export const SERVER_NAME = "opencmo";
export const SERVER_VERSION = "2.0.0";

/** The short workflow every client gets at `initialize` (plan: "Server instructions"). */
export const INSTRUCTIONS = [
  "OpenCMO edits and creates the user's videos. You do the thinking (storyboards, scripts, scene code, edit plans); OpenCMO renders, voices, stores and charges credits.",
  "Find: list_projects → list_clips → get_project_state(clip_id). Every clip tool takes clip_id. read_guide (or the opencmo://guides/* resources) before a kind of edit you have not done in this conversation.",
  "Explainers: read_guide explainer and get_explainer_kit, write the storyboard (say / label / visual per beat) and show it to the user before writing code; write the direction (motion spec with numbers) before the code; preview_explainer at times you pick, answer its review checklist and fix the worst problem each round (up to 6 rounds); then add_explainer.",
  "Credits: a tool marked as costing credits first answers with the price and a confirm code, spending nothing. Show the price to the user and call it again with only clip_id and confirm after they agree. Never confirm on your own.",
  "Slow work (generations, explainers, exports) returns an id at once: poll with get_generation, wait_for_media or get_export instead of calling the tool again.",
  "Look before you say done: capture_frame draws the clip as the export will (frames, visible layers and their boxes). Call it after changing the frame, cutting, or adding text or media. inspect_color, media_grab and media_waveform measure color, look inside library files and find pauses. If looking is not set up, give the user open_in_editor's link.",
  "Nothing is ever posted for the user: OpenCMO drafts, the user publishes.",
].join("\n");

/** JSON Schema of a zod input, in the shape `tools/list` takes. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
}

/**
 * A priced tool's schema adds `confirm`. Its required fields are listed in the description instead
 * of `required`: the confirm call sends only clip_id and confirm, and a top-level anyOf is not
 * accepted by every client.
 */
function pricedSchema(schema: Record<string, unknown>): { schema: Record<string, unknown>; required: string[] } {
  const required = ((schema.required as string[] | undefined) ?? []).filter((key) => key !== "clip_id");
  const properties = {
    ...((schema.properties as Record<string, unknown> | undefined) ?? {}),
    confirm: { type: "string", description: "The confirm code from the price step. Send it only after the user agreed to that price." },
  };
  const keep = ((schema.required as string[] | undefined) ?? []).filter((key) => key === "clip_id");
  return { schema: { ...schema, properties, required: keep }, required };
}

export function describeTool(tool: McpTool): Tool {
  const base = tool.inputJsonSchema ?? jsonSchema(tool.inputSchema);
  let inputSchema = base;
  let description = tool.description;
  if (tool.costsCredits) {
    const priced = pricedSchema(base);
    inputSchema = priced.schema;
    description +=
      `\n\nCosts credits, in two steps: call it once${priced.required.length ? ` with ${priced.required.join(", ")}` : ""} to get the price and a confirm code (nothing is spent), ` +
      "show the price to the user, and only after they agree call it again with just clip_id and confirm.";
  }
  return {
    name: tool.name,
    title: tool.title,
    description,
    inputSchema: inputSchema as Tool["inputSchema"],
    ...(tool.outputSchema ? { outputSchema: jsonSchema(tool.outputSchema) as Tool["outputSchema"] } : {}),
    annotations: { title: tool.title, ...tool.annotations },
  };
}

const issue = (error: z.ZodError) => {
  const first = error.issues[0];
  const path = first?.path.join(".");
  return `${path ? `${path}: ` : ""}${first?.message ?? "Invalid input."}`;
};

/**
 * An `ApiError` the user caused (status < 500): its message was written for them. Checked by shape:
 * under tsx the web modules (CommonJS) and this package (ESM) can hold two copies of the class.
 */
function userError(err: unknown): err is ApiError {
  if (err instanceof ApiError) return err.status < 500;
  const status = (err as { status?: unknown } | null)?.status;
  return err instanceof Error && err.constructor.name === "ApiError" && typeof status === "number" && status < 500;
}

function quoteResult(tool: McpTool, quote: McpQuote, confirm: string): McpResult {
  const body = {
    price_credits: quote.credits,
    changes: quote.lines,
    ...(quote.details ?? {}),
    confirm,
    expires_in_minutes: 10,
    next: `Show the price and the changes to the user. Only if they agree, call ${tool.name} again with clip_id and this confirm code.`,
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}

/** The key a confirm code is bound to: the tool and, for clip tools, the clip. */
const confirmPurpose = (tool: McpTool, args: Record<string, unknown>) =>
  typeof args.clip_id === "string" ? `${tool.name}:${args.clip_id}` : tool.name;

export async function callTool(tool: McpTool, args: Record<string, unknown>, ctx: McpToolContext): Promise<McpResult> {
  try {
    if (tool.costsCredits) {
      if (typeof args.confirm === "string" && args.confirm) {
        const { n: nonce, d: prepared } = read(args.confirm, ctx.userId, confirmPurpose(tool, args)) as { n: string; d: unknown };
        // Spent before the work starts: a retried or replayed code must not place the same thing twice.
        const { data: fresh, error } = await ctx.supabase.rpc("mcp_confirm_use", { p_nonce: nonce });
        if (error) throw new Error(`mcp_confirm_use: ${error.message}`);
        if (fresh !== true) return errorResult("That confirm code was already used. Ask for the price again.");
        return await tool.run(prepared, ctx);
      }
      const { confirm: _none, ...input } = args;
      const parsed = tool.inputSchema.safeParse(input);
      if (!parsed.success) return errorResult(issue(parsed.error));
      const quote = await tool.price!(parsed.data, ctx);
      if (typeof quote === "string") return errorResult(quote);
      return quoteResult(tool, quote, sign(ctx.userId, confirmPurpose(tool, args), { n: randomUUID(), d: quote.prepared }));
    }
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) return errorResult(issue(parsed.error));
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    // Errors the user caused come back as a result the model reads; ours are logged, not shown.
    if (err instanceof ConfirmError) return errorResult(err.message);
    if (userError(err)) return errorResult(err.message);
    console.error("[mcp] tool failed", tool.name, err);
    return errorResult("Something went wrong. Please try again.");
  }
}

export function buildServer(ctx: McpToolContext): Server {
  const server = new Server(
    { name: SERVER_NAME, title: "OpenCMO", version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } }, instructions: INSTRUCTIONS },
  );
  // One list per request: tools/list and tools/call see the same catalog.
  let listed: Promise<McpTool[]> | null = null;
  const tools = () => (listed ??= registry.tools(ctx));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await tools()).map(describeTool) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = (await tools()).find((item) => item.name === request.params.name);
    if (!tool) return errorResult(`Unknown tool: ${request.params.name}.`);
    return callTool(tool, (request.params.arguments ?? {}) as Record<string, unknown>, ctx);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: registry.prompts().map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      ...(prompt.arguments ? { arguments: prompt.arguments } : {}),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = registry.prompt(request.params.name);
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}.`);
    const args = request.params.arguments ?? {};
    const missing = (prompt.arguments ?? []).filter((arg) => arg.required && !args[arg.name]?.trim());
    if (missing.length) throw new McpError(ErrorCode.InvalidParams, `Missing ${missing.map((arg) => arg.name).join(", ")}.`);
    return { description: prompt.description, messages: [{ role: "user", content: { type: "text", text: prompt.render(args) } }] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const listed = await Promise.all(registry.templates().map((template) => template.list(ctx).catch(() => [])));
    return {
      resources: [
        ...registry.resources().map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          ...(resource.title ? { title: resource.title } : {}),
          ...(resource.description ? { description: resource.description } : {}),
          mimeType: resource.mimeType,
        })),
        ...listed.flatMap((items, index) => items.map((item) => ({ ...item, mimeType: registry.templates()[index]!.mimeType }))),
      ],
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: registry.templates().map((template) => ({
      uriTemplate: template.uriTemplate,
      name: template.name,
      ...(template.title ? { title: template.title } : {}),
      ...(template.description ? { description: template.description } : {}),
      mimeType: template.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const fixed = registry.resource(uri);
    const text = fixed ? await fixed.read(ctx) : await firstTemplate(uri, ctx);
    if (text === null) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}.`);
    return { contents: [{ uri, mimeType: "text/markdown", text }] };
  });

  return server;
}

async function firstTemplate(uri: string, ctx: McpToolContext): Promise<string | null> {
  for (const template of registry.templates()) {
    const text = await template.read(uri, ctx);
    if (text !== null) return text;
  }
  return null;
}

/** One MCP request (POST /mcp) for an authenticated caller. */
export async function handleMcp(request: Request, ctx: McpToolContext, parsedBody?: unknown): Promise<Response> {
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, parsedBody === undefined ? {} : { parsedBody });
  } finally {
    // JSON mode: the response is complete here, so nothing is left to stream.
    void server.close();
  }
}
