/**
 * Assistant providers, offline: tool schemas build correctly, Claude history maps tool results and
 * images.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/providers.check.ts
 */
import assert from "node:assert/strict";

import { ALWAYS_LOADED, anthropicFormat, closeDanglingToolUses, dropUnansweredServerToolUses, contextEditing, imagesOver, toolSearchOn, danglingToolUses, toolDefinitions, NOT_COMPLETED, MAX_STRICT_OPTIONAL, MAX_STRICT_TOOLS, optionalParams, refuseStrict, strictAllowed, strictKey, strictTools } from "./providers/anthropic";
import { BROWSER_INPUTS, TOOL_SPECS } from "./tools";

// ---------------------------------------------------------------- tool
const names = TOOL_SPECS.map((spec) => spec.name);
assert.ok(names.includes("capture"), "có tool trình duyệt capture");
assert.ok(names.includes("set_frame") && names.includes("remove_words"), "op của editor-core là tool");
assert.ok(names.includes("find_retakes"), "the rough cut finds retakes");
assert.equal(new Set(names).size, names.length, "tên tool không trùng");
assert.ok("capture" in BROWSER_INPUTS && !("set_frame" in BROWSER_INPUTS));
const text = JSON.stringify(TOOL_SPECS.map((spec) => spec.schema));
for (const banned of ['"pattern"', '"minimum"', '"maxLength"', '"$schema"', '"propertyNames"']) {
  assert.ok(!text.includes(banned), `schema gửi API không còn ${banned}`);
}
assert.equal(TOOL_SPECS.find((spec) => spec.name === "set_props")!.strict, false, "record không strict");
assert.equal(TOOL_SPECS.find((spec) => spec.name === "set_frame")!.strict, true);

// The API allows at most MAX_STRICT_TOOLS strict tools; credit-spending tools keep strict first.
const optionalSchema = (count: number) => ({ type: "object", properties: Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, {}])), required: [] });
const pricedSpec = { name: "replace_background", description: "", schema: optionalSchema(2), strict: true, approval: true };
const bigSpec = { name: "generate_media", description: "", schema: optionalSchema(23), strict: true, approval: true };
const sent = strictTools([...TOOL_SPECS, bigSpec, pricedSpec]);
assert.ok(TOOL_SPECS.filter((spec) => spec.strict).length > MAX_STRICT_TOOLS, "the clip scope has more eligible tools than the cap");
assert.ok(sent.size <= MAX_STRICT_TOOLS, "strict tools capped");

// A strict set the API refused for grammar size is not tried again: one 400 per instance, not one per step.
const refusedSpecs = [...TOOL_SPECS, bigSpec, pricedSpec];
assert.ok(strictAllowed(refusedSpecs), "strict is tried first");
assert.equal(refuseStrict(refusedSpecs), true, "the first refusal is logged");
assert.equal(strictAllowed(refusedSpecs), false, "later steps skip strict");
assert.equal(refuseStrict(refusedSpecs), false, "no second log line");
assert.ok(strictAllowed([pricedSpec]), "another strict set is still tried");
assert.equal(strictKey([{ name: "plain", description: "", schema: optionalSchema(0), strict: false }]), "", "no strict tools, no key");
assert.equal(strictAllowed([{ name: "plain", description: "", schema: optionalSchema(0), strict: false }]), false);
assert.ok(!sent.has("generate_media"), "one large priced schema does not crowd out the small ones");
// Eager streaming skips the API's JSON check: only strict tools (valid JSON by grammar) may use it.
const defined = toolDefinitions([...TOOL_SPECS, bigSpec, pricedSpec], true) as { name: string }[];
for (const tool of defined) {
  const eager = (tool as { eager_input_streaming?: boolean }).eager_input_streaming === true;
  assert.equal(eager, (tool as { strict?: boolean }).strict === true, `${tool.name}: eager streaming only with strict`);
}
assert.ok(!(defined.find((tool) => tool.name === "generate_media") as { eager_input_streaming?: boolean }).eager_input_streaming, "generate_media input is checked by the API");
const optional = [...TOOL_SPECS, bigSpec, pricedSpec].filter((spec) => sent.has(spec.name)).reduce((sum, spec) => sum + optionalParams(spec.schema), 0);
assert.ok(optional <= MAX_STRICT_OPTIONAL, `optional params over strict tools capped (${optional})`);
assert.equal(optionalParams({ type: "object", properties: { a: {}, b: { type: "object", properties: { c: {} }, required: [] } }, required: ["a"] }), 2);
assert.ok(sent.has("replace_background"), "priced tool stays strict even last in the list");
assert.ok(!sent.has("update_element"), "non-eligible tool never strict");

async function main(): Promise<void> {
// ---------------------------------------------------------------- Claude
const claude = anthropicFormat.toolResults(
  [{ id: "toolu_1", name: "capture", ok: true, content: "{}", images: [{ data: "AAAA", mimeType: "image/jpeg" }] }],
  "state",
) as { type: string; content?: { type: string }[] }[];
assert.deepEqual(claude.map((block) => block.type), ["tool_result", "text"], "tool_result trước, chữ sau");
assert.deepEqual(claude[0]!.content!.map((block) => block.type), ["text", "image"]);

// ---------------------------------------------------------------- stopped turns
// A stopped turn left two tool_use blocks unanswered and the next prompt followed straight after.
const stopped = [
  { role: "user" as const, content: [{ type: "text", text: "animate" }] },
  { role: "assistant" as const, content: [{ type: "tool_use", id: "t1", name: "save_frame", input: {} }, { type: "tool_use", id: "t2", name: "save_frame", input: {} }] },
  { role: "user" as const, content: [{ type: "text", text: "hello" }] },
];
const closed = closeDanglingToolUses(stopped);
assert.equal(closed.length, 3, "answers go into the next user message");
const answer = closed[2]!.content as { type: string; tool_use_id?: string; content?: string }[];
assert.deepEqual(answer.map((block) => block.type), ["tool_result", "tool_result", "text"], "tool_result first, then the prompt");
assert.deepEqual(answer.slice(0, 2).map((block) => [block.tool_use_id, block.content]), [["t1", NOT_COMPLETED], ["t2", NOT_COMPLETED]]);
assert.equal((stopped[2]!.content as unknown[]).length, 1, "stored history not mutated");
// Partly answered: only the missing one is added, after the existing answer.
const partial = closeDanglingToolUses([stopped[0]!, stopped[1]!, { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] }]);
assert.deepEqual((partial[2]!.content as { tool_use_id: string }[]).map((block) => block.tool_use_id), ["t1", "t2"]);
// Last message is the unanswered tool_use: a user message is added.
assert.equal(closeDanglingToolUses(stopped.slice(0, 2)).at(-1)!.role, "user");
// A tool that did run before the turn was interrupted is reported as it ran, not as never run:
// told "not completed", the model inserted the same b-roll again.
assert.deepEqual(danglingToolUses(stopped), ["t1", "t2"]);
const ran = closeDanglingToolUses(stopped, new Map([["t1", { ok: true, content: '{"ok":true,"path":"frame.png"}' }]]));
const reported = ran[2]!.content as { tool_use_id?: string; content?: string; is_error?: boolean }[];
assert.deepEqual([reported[0]!.content, reported[0]!.is_error], ['{"ok":true,"path":"frame.png"}', false]);
assert.deepEqual([reported[1]!.content, reported[1]!.is_error], [NOT_COMPLETED, true]);
// A clean history is passed through unchanged.
assert.deepEqual(closeDanglingToolUses([stopped[0]!, { role: "assistant" as const, content: [{ type: "text", text: "hi" }] }]).length, 2);

// A tool search the response never ran (it stopped for a client tool in the same message) is dropped
// before sending; an answered search and every other block stay.
const unrun = [
  { role: "user" as const, content: [{ type: "text", text: "make it" }] },
  {
    role: "assistant" as const,
    content: [
      { type: "server_tool_use", id: "srv1", name: "tool_search_tool_bm25", input: { query: "frame" } },
      { type: "tool_search_tool_result", tool_use_id: "srv1", content: { type: "tool_search_tool_search_result", tool_references: [] } },
      { type: "tool_use", id: "t9", name: "set_frame", input: {} },
      { type: "server_tool_use", id: "srv2", name: "tool_search_tool_bm25", input: { query: "explainer" } },
    ],
  },
  { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t9", content: "ok" }] },
];
const cleaned = dropUnansweredServerToolUses(unrun);
assert.deepEqual((cleaned[1]!.content as { type: string; id?: string }[]).map((block) => block.id ?? block.type), ["srv1", "tool_search_tool_result", "t9"]);
assert.equal(cleaned[0], unrun[0]);
assert.equal(cleaned[2], unrun[2]);
assert.equal(dropUnansweredServerToolUses(cleaned)[1], cleaned[1]);
const onlySearch = dropUnansweredServerToolUses([{ role: "assistant" as const, content: [{ type: "server_tool_use", id: "s", name: "tool_search_tool_bm25", input: {} }] }]);
assert.deepEqual(onlySearch[0]!.content, [{ type: "text", text: "…" }]);

// ---------------------------------------------------------------- bớt ảnh cũ
// Ba tin nhắn có ảnh: chỉ hai cái mới nhất giữ ảnh; đầu vào không bị sửa.
const withImage = (id: string) => ({
  role: "user" as const,
  content: anthropicFormat.toolResults([{ id, name: "capture", ok: true, content: "{}", images: [{ data: "AAAA", mimeType: "image/jpeg" }] }]),
});
const history = [withImage("a"), { role: "assistant" as const, content: [] }, withImage("b"), withImage("c")];
const trimmed = anthropicFormat.trimImages(history, 2);
const imagesIn = (message: { content: unknown[] }) => JSON.stringify(message.content).split('"type":"image"').length - 1;
assert.deepEqual(trimmed.map(imagesIn), [0, 0, 1, 1], "Claude: chỉ giữ ảnh của 2 tin nhắn cuối");
assert.equal(imagesIn(history[0]!), 1, "lịch sử gốc giữ nguyên");
assert.match(JSON.stringify(trimmed[0]!.content), /image omitted/);

// Ảnh đính kèm ở đầu lượt cũng bị bớt khi đã cũ (review PR 19): không thì nó đi theo mọi request.
const attached = { role: "user" as const, content: anthropicFormat.userTurn("hi", "state", [{ data: "AAAA", mimeType: "image/jpeg" }]) };
assert.deepEqual(anthropicFormat.trimImages([attached, withImage("x"), withImage("y")], 2).map(imagesIn), [0, 1, 1]);

// Windowed trimming: images pile up to keep + window, then the oldest are cut back to keep at once,
// so the cached prefix is rewritten every `window` captures instead of on each one.
const omitted = (count: number) => Math.max(0, count - 2 - imagesOver(count, 2, 2));
assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(omitted), [0, 0, 0, 0, 3, 3, 5, 5, 7]);
const many = ["a", "b", "c", "d", "e"].map(withImage);
assert.deepEqual(anthropicFormat.trimImages(many, 2, 2).map(imagesIn), [0, 0, 0, 1, 1]);
assert.deepEqual(anthropicFormat.trimImages(many.slice(0, 4), 2, 2).map(imagesIn), [1, 1, 1, 1], "nothing cut before the window fills");

// Context editing is off unless asked for; on, it never clears the guides, skills or plan.
assert.equal(contextEditing({} as NodeJS.ProcessEnv), null);
assert.ok(contextEditing({} as NodeJS.ProcessEnv, true), "the CMO chat clears old tool results without the flag");
const editing = contextEditing({ OPENCMO_AGENT_CONTEXT_EDITING: "1" } as unknown as NodeJS.ProcessEnv)!;
assert.equal(editing.beta, "context-management-2025-06-27");
assert.deepEqual(editing.context_management.edits[0]!.exclude_tools, ["read_guide", "read_skill", "update_plan"]);

// Tool search: off by default; on, the search tool leads, the core stays loaded, the rest defers.
assert.equal(toolSearchOn({} as NodeJS.ProcessEnv), false);
const plain = toolDefinitions(TOOL_SPECS, false) as { name: string; defer_loading?: boolean }[];
assert.ok(plain.every((tool) => !tool.defer_loading), "nothing deferred without the flag");
const searched = toolDefinitions(TOOL_SPECS, false, true) as { name: string; type?: string; defer_loading?: boolean }[];
assert.equal(searched[0]!.type, "tool_search_tool_bm25_20251119");
assert.ok(!searched[0]!.defer_loading, "the search tool itself is never deferred");
for (const tool of searched.slice(1)) assert.equal(Boolean(tool.defer_loading), !ALWAYS_LOADED.has(tool.name), tool.name);
const loaded = searched.filter((tool) => !tool.defer_loading).length;
assert.ok(loaded < searched.length / 2 + 5, `most tools wait for a search (${loaded} of ${searched.length} loaded)`);
// Every always-loaded name is a real tool of the clip scope (or a priced one configured elsewhere).
const priced = new Set(["create_video", "redo_keyframe", "edit_video", "replace_background", "plan_video", "generate_media", "add_voiceover", "request_export", "add_captions", "place_broll", "wait_for_media", "undo", "read_skill", "plan_explainer", "preview_explainer", "add_explainer"]);
for (const name of ALWAYS_LOADED) assert.ok(names.includes(name) || priced.has(name), `${name} is a tool`);

// Ảnh đính kèm câu lệnh (khung đang xem) nằm giữa câu lệnh và trạng thái.
assert.deepEqual(
  (anthropicFormat.userTurn("hi", "<project_state>{}</project_state>", [{ data: "AAAA", mimeType: "image/jpeg" }]) as { type: string }[]).map((block) => block.type),
  ["text", "image", "text"],
);

console.log("agent providers: mọi kiểm tra xanh");
}


void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// The explainer guide sends the model to find_icons: it must be loaded with the explainer tools, or
// each /explain starts with a tool search.
for (const name of ["preview_explainer", "add_explainer", "find_icons"]) {
  assert.ok(ALWAYS_LOADED.has(name), `${name} is always loaded`);
}
assert.ok(TOOL_SPECS.some((tool) => tool.name === "find_icons"), "find_icons is a real tool");
assert.ok(!TOOL_SPECS.some((tool) => ["find_lotties", "preview_3d"].includes(tool.name)), "3D and Lottie tools are gone");
