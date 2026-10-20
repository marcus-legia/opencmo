/**
 * One structured call to any OpenAI-compatible chat API (Groq, OpenRouter, Together, DeepSeek,
 * Ollama…): the `openai` provider of the agent registry. Plain fetch, no SDK: the shared part of
 * these APIs is `POST {base}/chat/completions`, and each vendor's SDK would pin us to that vendor.
 *
 * The answer is asked for as JSON with the schema (`json_schema`, not strict: strict mode rejects
 * optional fields, and zod is the gate anyway). An endpoint or model without `json_schema` gets one
 * more try in JSON mode with the schema in the system prompt.
 *
 * No `server-only`: the checks run it with tsx against a local fake server.
 */

export class OpenAiCompatError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the endpoint could not be reached. */
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenAiCompatError";
  }
}

/** Our own time limit ran out: the request's problem, not the provider's (see `outage`). */
export class OpenAiCompatTimeout extends Error {
  constructor() {
    super("The model took too long to answer.");
    this.name = "OpenAiCompatTimeout";
  }
}

export type CompatContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export type CompatRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  /** The user message: text, or text and images (data URLs). */
  content: CompatContent;
  /** JSON schema of the answer. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  /** Tests only. */
  fetchImpl?: typeof fetch;
};

export type CompatAnswer = { json: unknown; model: string; usage: { input: number; output: number; cacheRead: number } };

const DEFAULT_TIMEOUT_MS = 120_000;

/** The answer's JSON (not yet checked against the schema), or a thrown error. */
export async function compatJson(request: CompatRequest): Promise<CompatAnswer> {
  try {
    return await post(request, { type: "json_schema", json_schema: { name: "answer", schema: request.schema, strict: false } }, request.system);
  } catch (error) {
    if (!(error instanceof OpenAiCompatError) || error.status !== 400 || !/response_format|json_schema|schema/i.test(error.message)) throw error;
    const system = `${request.system}\n\nAnswer with one JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(request.schema)}`;
    return post(request, { type: "json_object" }, system);
  }
}

async function post(request: CompatRequest, responseFormat: Record<string, unknown>, system: string): Promise<CompatAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (request.fetchImpl ?? fetch)(`${request.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? 8000,
        temperature: 0,
        response_format: responseFormat,
        messages: [
          { role: "system", content: system },
          { role: "user", content: request.content },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new OpenAiCompatTimeout();
    throw new OpenAiCompatError(error instanceof Error ? error.message : "connection failed", 0);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  if (!response.ok) throw new OpenAiCompatError(errorMessage(text) || response.statusText, response.status);
  let body: { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new OpenAiCompatError("the endpoint did not answer JSON", 502);
  }
  const choice = body.choices?.[0];
  const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const usage = { input: Math.max(0, (body.usage?.prompt_tokens ?? 0) - cached), output: body.usage?.completion_tokens ?? 0, cacheRead: cached };
  if (choice?.finish_reason === "length") throw new SyntaxError("the answer was cut off at max_tokens");
  // A malformed answer is the model's, not the provider's: a SyntaxError, which `outage` ignores.
  return { json: JSON.parse(choice?.message?.content ?? ""), model: body.model ?? request.model, usage };
}

const errorMessage = (text: string): string => {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    return typeof body.error === "string" ? body.error : (body.error?.message ?? "");
  } catch {
    return text.slice(0, 300);
  }
};
