/**
 * Model GIẢ: kịch bản cố định theo câu lệnh, cùng giao diện `Provider`. Để
 * contract check và E2E chạy trọn vòng lặp — tool server, tool trình duyệt,
 * CAS, checkpoint, credit, SSE, Undo — mà không tốn tiền, không cần mạng.
 * Lịch sử ở dạng content block của Claude (`anthropicFormat`).
 *
 * Kịch bản:
 *   "check" + "square" → set_frame 1080×1080 VÀ capture [1] cùng bước
 *   "check"            → capture [1, 2]
 *   "ask"              → ask_user (lượt chờ câu trả lời) → nhắc lại câu trả lời
 *   "silence"/"pause"  → find_silences → remove_ranges các gợi ý cắt
 *   "plan"             → update_plan → add_text
 *   "library"          → list_library → insert_asset (video đầu tiên) → capture
 *   "listen"           → media_waveform
 *   "lint"             → check + read_guide cùng bước
 *   "expensive"        → một bước báo usage rất lớn (đường hết credit giữ)
 *   "export"           → request_export 9:16 + bản 1:1 (thẻ duyệt, không tốn credit)
 *   "voice-over"       → generate_media voice (thẻ duyệt có giá)
 *   "b-roll shot"      → generate_media video: brief theo câu trích trong câu lệnh
 *   "save a frame"     → save_frame (tool tab: frame không chữ vào thư mục Frames)
 *   "square then undo" → set_frame 1080×1080 → undo (về như trước yêu cầu này)
 *   "cinematic"        → get_project_state → apply_color look ấm cho mọi video (E3)
 *   "side by side with" → list_library → insert_asset → apply_layout side_by_side: người nói trái, B-roll phải (E5)
 *   "feedback"         → send_feedback (báo giới hạn, diễn đạt lại bằng tiếng Anh)
 *   "intro"            → plan_video intro (the Video agent team; storyboard card)
 *   "replace the background" → replace_background 2–6 s (cut-out + new background, one card)
 *   "look like night"  → edit_video 2–6 s (the speaker's own video redrawn, one card)
 *   "/video …" (slash directive), or "make a … video" on a blank edit → create_video at the length and frame asked
 *                        ("20-second", "square"; else 15 s and the edit's frame) · "/image …" → generate_media image at 0 s
 *   "/explain …"       → shows the storyboard (say, label, picture per beat) and asks; then "go" (or "go ahead"
 *                        up front) → preview_explainer → a subject check per still → add_explainer (price card)
 *                        Vaccine topics use the v2 vaccine scene, everything else Track A's showcase (`fake-explainers.ts`).
 *   "/roughcut"        → proposes the cut and asks; then "go" (or "just do it" up front) → find_retakes + find_filler_words → ONE remove_words
 *                        (earlier takes + fillers) → remove_silence 0.6 s / 0.15 s → reports what went
 *   "ai image at Ns"   → generate_media image placed by time, no quote (project without a script); "variants" → 3 variants
 *   "generate b-roll:" → starter B-roll: nhiều generate_media image trong MỘT lượt (một thẻ duyệt)
 *   "generate"/"b-roll" → generate_media image: brief theo một dòng của <clip_context>
 *   "3d visual"        → update_plan + preview_3d (cảnh code: cột nhân đôi, neo "growing") → add_3d_scene
 *   "repurpose"        → add_voiceover replace: kịch bản mới từ hai dòng đầu (thẻ duyệt có giá)
 *   "3d studio"/"3d animation" → preview_3d (cảnh code: số đếm lên, con số của câu trích) → add_3d_scene (thẻ duyệt có giá)
 *   "more visual"      → update_plan → add_icon + add_diagram neo bằng quote
 *   "square"/"1:1"     → set_frame 1080×1080
 *   "vertical"/"9:16"  → set_frame 1080×1920
 *   "filler"           → find_filler_words → remove_words các id tìm được, on the video the result names;
 *                        "second video" → on the first non-main video of <clip_context> speech_sources
 *   "introduce myself" / "name tag" / "lower third" → add_title on the line with the speaker's name
 *   "title"            → add_text
 *   "broken"           → set_frame với input sai (đường lỗi của tool)
 *   "diagram"          → add_diagram hai bước lúc câu "start with the result…" (16–21s mẫu)
 *   "stat"             → add_chart stat 3 lúc "first three seconds" (14–17s mẫu)
 *   "split the screen" → set_layout split-bottom 16–21s → add_diagram cùng khoảng (tự vào panel)
 *   "icon"             → find_icons → add_icon trending-up lúc "growing" (1.5–4s mẫu)
 *   "emoji"            → find_lotties → add_lottie emoji/scream neo quote "people lose viewers"
 *   "b-roll from the library" → search_transcript + list_library in one step → place_broll at "better hooks"
 *   "hook title" / "caption style … classic" / "punch-in zoom" / "problems … fix" / "make it better" /
 *   "call to action" / "uppercase … outline" / "fade to black" → the eval's edit tasks, done as the guides say
 *   "gate test"        → insert_node an image missing from the library; the verify gate then makes it delete_element it
 *   còn lại            → trả lời bằng chữ
 * Sau tool_result: ảnh thì đếm và nói số ảnh đã xem; còn lại một câu kết.
 */

import { aiModel } from "@opencmo/editor-core/generate";

import { explainerFor, type FakeExplainer } from "./fake-explainers";

import { anthropicFormat } from "./anthropic";
import type { Delta, Provider, Step, StepRequest, StoredMessage, ToolCall } from "./types";

let counter = 0;
const id = (): string => `toolu_fake_${Date.now().toString(36)}${(counter++).toString(36)}`;

type Block = { type: string; text?: string; tool_use_id?: string; is_error?: boolean; content?: unknown; source?: unknown };

const text = (value: string) => ({ type: "text", text: value, citations: null });

/** Cảnh code mẫu (spec code-scenes). Câu trích nằm ở dòng đầu để bước sau đọc lại. */
function sceneCode(quote: string, body: string): string {
  return `// quote: ${quote.replace(/\n/g, " ")}\n${body}`;
}
/** The tool input of an explainer: the storyboard (with `visual` per beat), its code and its look. */
const explainerInput = (explainer: FakeExplainer) => ({ ...explainer });
/** The words that asked for an explainer: the latest `/explain` command of the conversation. */
const explainAsk = (history: StoredMessage[]): string =>
  [...history].reverse().map(userText).find((words) => /<command name="\/explain">/.test(words)) ?? "";
const EXPLAINER_SCRIPT = "Explainer script";
const explainerVoice = () => aiModel("motion-explainer")?.limits.voices?.[0] ?? "Aria";
const quoteOf = (code: string): string => /^\/\/ quote: (.*)$/m.exec(code)?.[1] ?? "";
const use = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: id(), name, input });

const ROUGHCUT_PLAN = "Rough cut plan";
const userText = (message: StoredMessage): string =>
  // Without the <project_state>/<check> blocks that ride along with tool results: only the user's words.
  (message.role === "user" ? (message.content as Block[]) : [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ")
    .split(/<clip_context>|<project_state>|<check>/)[0]!;
/**
 * A rough cut is running: the user's latest words are "/roughcut … just do it", or say go to the
 * assistant message right before them that proposed the cut.
 */
function roughcutRun(history: StoredMessage[]): boolean {
  const index = history.findLastIndex((message) => userText(message).trim());
  if (index < 0) return false;
  const words = userText(history[index]!);
  if (/^\s*\/roughcut\b/i.test(words) && /just do it/i.test(words)) return true;
  if (index < 1 || !/^\s*(go|yes|ok|cut it|do it)\b/i.test(words)) return false;
  const before = history[index - 1]!;
  return before.role === "assistant" && (before.content as Block[]).some((block) => block.type === "text" && block.text?.startsWith(ROUGHCUT_PLAN));
}
const untrusted = <T>(raw: string | undefined): T | undefined => (raw ? (JSON.parse(raw) as { untrusted_data?: T }).untrusted_data : undefined);

function script(history: StoredMessage[]): unknown[] {
  const user = [...history].reverse().find((message) => message.role === "user");
  const blocks = (user?.content ?? []) as Block[];
  const results = blocks.filter((block) => block.type === "tool_result");

  if (results.length) {
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    const previous = anthropicFormat.callsIn(assistant?.content ?? []).map((call) => call.name);
    const raw0 = typeof results[0]!.content === "string" ? (results[0]!.content as string) : "{}";
    // Câu lệnh của lượt: tin nhắn người dùng gần nhất có lời (không phải tool_result).
    const asked = [...history]
      .reverse()
      .map((message) => ((message.role === "user" ? message.content : []) as Block[]).filter((block) => block.type === "text").map((block) => block.text ?? "").join(" "))
      // Sau lượt ghi, tin nhắn tool_result kèm khối <project_state>: bỏ, chỉ giữ lời người dùng.
      .map((value) => value.split(/<clip_context>|<project_state>|<check>/)[0]!)
      .find((value) => value.trim())
      ?.toLowerCase() ?? "";
    if (previous.includes("set_frame") && /then undo/.test(asked)) return [text("On second thought, undoing that."), use("undo", {})];
    if (previous.includes("undo")) return [text(raw0.includes('"changed":true') ? "Undone: the clip is back to how it was." : "There was nothing to undo.")];
    if (previous.includes("send_feedback")) return [text("I sent that to the OpenCMO team.")];
    if (previous.includes("get_project_state") && /cinematic/.test(asked)) {
      const ids = [...raw0.matchAll(/\\?"id\\?":\\?"([^"\\]+)\\?",\\?"tag\\?":\\?"video/g)].map((match) => match[1]!);
      return [
        text("Grading every shot warm and cinematic."),
        use("apply_color", {
          element_ids: ids,
          adjustments: { wheels: { gain: [0.06, 0.02, -0.04], lift: [-0.02, 0, 0.03] }, contrast: 0.2, saturation: -0.1, grain: 0.15, vignette: { amount: 0.3 } },
        }),
      ];
    }
    if (previous.includes("apply_color")) return [text(results.some((block) => block.is_error) ? "The grade could not be applied." : "The clip now has a warm cinematic grade.")];
    if (previous.includes("ask_user")) {
      const parsed = JSON.parse(raw0) as { user_answer?: { choices?: string[]; text?: string }; skipped?: boolean };
      if (parsed.skipped) return [text("No problem, I'll keep it as it is.")];
      return [text(`You chose: ${[...(parsed.user_answer?.choices ?? []), parsed.user_answer?.text].filter(Boolean).join(", ")}.`)];
    }
    if (previous.includes("preview_explainer")) {
      // A result with stills is a list of blocks (text + images); the JSON is in the text block.
      const content = results[0]!.content;
      const raw = typeof content === "string" ? content : ((content as Block[]).find((item) => item.type === "text")?.text ?? "{}");
      const parsed = JSON.parse(raw) as { ok?: boolean; error?: string; issues?: string[] };
      if (!parsed.ok) return [text(`The explainer preview failed: ${parsed.error ?? "unknown error"}`)];
      // The subject check of the guide: one line per still, what it shows against what the beat says.
      const explainer = explainerFor(explainAsk(history));
      const checked = explainer.beats.map((beat, index) => `Still ${index + 1}: shows ${beat.visual}; the beat says “${beat.say}”`).join("\n");
      return [
        text(`I looked at the stills${parsed.issues?.length ? ` (${parsed.issues.length} layout notes)` : ""}.\n${checked}\nEvery still shows what its beat says. Here is the price.`),
        use("add_explainer", { ...explainerInput(explainer), voice: explainerVoice() }),
      ];
    }
    if (previous.includes("preview_3d")) {
      const call = anthropicFormat.callsIn(assistant?.content ?? []).find((item) => item.name === "preview_3d");
      const code = String((call?.input as { code?: string } | undefined)?.code ?? "");
      const parsed = JSON.parse(raw0) as { ok?: boolean; error?: string; layout?: { issues?: string[] }[] };
      if (!parsed.ok) return [text(`The 3D preview failed: ${parsed.error ?? "unknown error"}`)];
      return [use("add_3d_scene", { title: "Hero moment", code, quote: quoteOf(code) })];
    }
    // /roughcut after "go": the reads came back together; cut the earlier takes and the fillers in one
    // call, then the pauses, then say what went.
    if (roughcutRun(history) && previous.includes("find_retakes")) {
      const calls = anthropicFormat.callsIn(assistant?.content ?? []);
      const resultOf = (name: string) => {
        const block = results.find((item) => item.tool_use_id === calls.find((call) => call.name === name)?.id);
        return typeof block?.content === "string" ? block.content : undefined;
      };
      const takes = untrusted<{ retakes?: Array<{ drop_word_ids: string[] }> }>(resultOf("find_retakes"))?.retakes ?? [];
      const fillers = (untrusted<{ suggestions?: Array<{ id?: string; reason: string }> }>(resultOf("find_filler_words"))?.suggestions ?? [])
        .filter((item) => item.reason === "filler" && item.id)
        .map((item) => item.id!);
      const ids = [...new Set([...takes.flatMap((take) => take.drop_word_ids), ...fillers])];
      return ids.length ? [text(`Cutting ${takes.length} earlier ${takes.length === 1 ? "take" : "takes"} and ${fillers.length} filler ${fillers.length === 1 ? "word" : "words"}.`), use("remove_words", { word_ids: ids })] : [use("remove_silence", { min_pause: 0.6, padding: 0.15 })];
    }
    if (roughcutRun(history) && previous.includes("remove_words")) {
      return results.some((block) => block.is_error) ? [text("That cut did not work — nothing was changed.")] : [text("Now the long pauses."), use("remove_silence", { min_pause: 0.6, padding: 0.15 })];
    }
    if (roughcutRun(history) && previous.includes("remove_silence")) {
      return [text(results.some((block) => block.is_error) ? "The pauses could not be cut." : "Rough cut done: the earlier takes, the filler sounds and the long pauses are gone. You can undo it in one click.")];
    }
    if (previous.includes("find_silences")) {
      const cuts = ((JSON.parse(raw0) as { silences?: Array<{ cut: { start: number; end: number } | null }> }).silences ?? [])
        .map((item) => item.cut)
        .filter((cut): cut is { start: number; end: number } => Boolean(cut));
      return cuts.length ? [use("remove_ranges", { ranges: cuts })] : [text("There are no long pauses to cut.")];
    }
    if (previous.includes("update_plan")) return [use("add_text", { text: "Watch this", start: 0, end: 3 })];
    // Library B-roll the way the guide says: the reads came back together, then one place_broll.
    if (/b-roll from the library/.test(asked) && !/side by side/.test(asked) && previous.includes("list_library") && previous.includes("search_transcript")) {
      const listing = anthropicFormat.callsIn(assistant?.content ?? []).find((call) => call.name === "list_library");
      const block = results.find((item) => item.tool_use_id === listing?.id);
      const listed = typeof block?.content === "string" ? block.content : undefined;
      const assets = listed ? ((JSON.parse(listed) as { untrusted_data?: { assets?: Array<{ path: string; type: string; role?: string }> } }).untrusted_data?.assets ?? []) : [];
      const media = assets.find((asset) => !asset.role && asset.type === "VIDEO");
      return media ? [use("place_broll", { beats: [{ path: media.path, quote: "better hooks" }] })] : [text("The library has no B-roll yet.")];
    }
    if (/side by side with/.test(asked) && previous.includes("list_library")) {
      const assets = (JSON.parse(raw0) as { untrusted_data?: { assets?: Array<{ path: string; type: string; role?: string }> } }).untrusted_data?.assets ?? [];
      const media = assets.find((asset) => !asset.role && (asset.type === "VIDEO" || asset.type === "IMAGE"));
      return media ? [use("insert_asset", { path: media.path, start: 1, end: 6 })] : [text("The library has no B-roll yet.")];
    }
    if (/side by side with/.test(asked) && previous.includes("insert_asset") && !results.some((block) => block.is_error)) {
      // Id lấy từ <project_state> đi kèm kết quả ghi: video của clip và rect B-roll vừa thêm.
      const state = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join(" ");
      const master = /"id":"([^"]+)","tag":"video"[^}]*"assets\/master\.mp4"/.exec(state)?.[1];
      const added = [...state.matchAll(/"id":"([^"]+)","tag":"rect"/g)].at(-1)?.[1];
      if (!master || !added) return [text("I could not find the clip video and the new B-roll.")];
      return [use("apply_layout", { layout: "side_by_side", slots: [{ slot: "left", element_ids: [master] }, { slot: "right", element_ids: [added] }] })];
    }
    // F2: phụ đề tốn credit qua thẻ duyệt — tìm phần tử trong get_document rồi gọi tool.
    if (/caption the b-?roll|translate the captions/.test(asked) && previous.includes("get_document")) {
      const found: Record<string, unknown>[] = [];
      const visit = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") {
          found.push(value as Record<string, unknown>);
          Object.values(value).forEach(visit);
        }
      };
      visit(JSON.parse(raw0));
      if (/translate/.test(asked)) {
        const layer = found.find((node) => node.kind === "captions" && typeof node.src === "string" && node.src.startsWith("assets/transcripts/"));
        return layer ? [use("translate_captions", { element_id: layer.id, language: "Spanish" })] : [text("There are no saved captions to translate.")];
      }
      const broll = found.find((node) => node.kind === "rect" && Array.isArray(node.paints) && (node.paints as { type?: string }[]).some((paint) => paint.type === "video"));
      return broll ? [use("add_captions", { element_id: broll.id })] : [text("There is no B-roll video to caption.")];
    }
    if (previous.includes("plan_video")) {
      return [text(results.some((block) => block.is_error) || /"declined"|"INVALID_INPUT"/.test(raw0) ? "The intro was not added." : "Done: the intro is on the clip. You can undo it in one click.")];
    }
    if (previous.includes("add_captions") || previous.includes("translate_captions")) {
      return [text(results.some((block) => block.is_error) || /"declined"|"error"|"pending"/.test(raw0) ? "The captions were not added." : "Done: the new captions layer is on the timeline.")];
    }
    if (previous.includes("apply_layout")) return [text(results.some((block) => block.is_error) ? "The layout could not be applied." : "The speaker and the B-roll are side by side now.")];
    if (previous.includes("list_library")) {
      const assets = (JSON.parse(raw0) as { untrusted_data?: { assets?: Array<{ path: string; type: string; role?: string }> } }).untrusted_data?.assets ?? [];
      const video = assets.find((asset) => !asset.role && (asset.type === "VIDEO" || asset.type === "IMAGE"));
      return video ? [use("insert_asset", { path: video.path, start: 1, end: 3 })] : [text("The library has no B-roll yet.")];
    }
    if (previous.includes("insert_asset") && !results.some((block) => block.is_error)) return [use("capture", { times: [2] })];
    if (previous.includes("media_waveform")) return [text("I listened to the clip.")];
    if (previous.includes("find_filler_words")) {
      const raw = typeof results[0]!.content === "string" ? (results[0]!.content as string) : "{}";
      const data = (JSON.parse(raw) as { untrusted_data?: { source?: { element_id: string } | null; suggestions?: Array<{ id?: string }> } }).untrusted_data;
      const ids = (data?.suggestions ?? []).map((item) => item.id).filter((value): value is string => Boolean(value));
      // Cut the video the words came from: its ids mean nothing on another one.
      if (ids.length) return [use("remove_words", { word_ids: ids, ...(data?.source ? { element_id: data.source.element_id } : {}) })];
    }
    const images = results.flatMap((block) =>
      Array.isArray(block.content) ? (block.content as Block[]).filter((item) => item.type === "image") : [],
    ).length;
    if (previous.includes("request_export")) {
      const raw = typeof results[0]!.content === "string" ? (results[0]!.content as string) : "{}";
      const parsed = JSON.parse(raw) as { declined?: boolean; ok?: boolean; error?: string; INVALID_INPUT?: string };
      if (parsed.declined) return [text("Okay, nothing was exported.")];
      if (parsed.ok) return [text("Your files are rendering. Each one gets a Download button here when it's ready.")];
      return [text(`That didn't work: ${parsed.error ?? parsed.INVALID_INPUT ?? "unknown error"}`)];
    }
    if (previous.includes("generate_media") || previous.includes("add_3d_scene") || previous.includes("add_voiceover") || previous.includes("add_explainer")) {
      const raw = typeof results[0]!.content === "string" ? (results[0]!.content as string) : "{}";
      const parsed = JSON.parse(raw) as { declined?: boolean; ok?: boolean; error?: string; INVALID_INPUT?: string };
      if (parsed.declined) return [text("Okay, I didn't create anything.")];
      if (parsed.ok) return [text("It's being generated now and will appear on the clip when it's ready.")];
      return [text(`That didn't work: ${parsed.error ?? parsed.INVALID_INPUT ?? "unknown error"}`)];
    }
    if (previous.includes("save_frame")) {
      // Kết quả có ảnh: content là mảng (khối chữ + khối ảnh), JSON nằm ở khối chữ.
      const content = results[0]!.content;
      const raw =
        typeof content === "string"
          ? content
          : ((content as Block[]).find((item) => item.type === "text")?.text ?? "{}");
      const parsed = JSON.parse(raw) as { path?: string; error?: string };
      return [text(parsed.path ? `Saved the frame as ${parsed.path}.` : `That didn't work: ${parsed.error ?? "unknown error"}`)];
    }
    if (previous.includes("capture")) {
      return [text(images ? `I looked at ${images} ${images === 1 ? "frame" : "frames"}: the speaker is in frame.` : "I could not see the frames.")];
    }
    const failed = results.some((block) => block.is_error);
    if (previous.includes("create_video")) {
      if (/"declined":\s*true/.test(raw0)) return [text("No problem, nothing was spent. What should I change: the story, the length or the tone?")];
      if (!failed && /"ok":\s*true/.test(raw0)) return [text("The video is on its way: the shots, the voice-over and the music fill in on the timeline as they finish.")];
      const reason = /"(?:INVALID_INPUT|error)"\s*:\s*"([^"]+)"/.exec(raw0)?.[1];
      return [text(reason ? `I could not make that video: ${reason}` : "That did not work — nothing was changed.")];
    }
    return [text(failed ? "That did not work — nothing was changed." : "Done. You can undo this in one click.")];
  }

  const original = blocks.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join(" ");
  const prompt = original.toLowerCase();
  // Chỉ câu lệnh, không phải khối <clip_context>/<project_state> đi kèm.
  const ask = prompt.split(/<clip_context>|<project_state>/)[0]!;
  // The verify gate (loop.ts): finishing with check errors open. Remove what each error names.
  if (ask.startsWith("before you finish:")) {
    const report = /<check>(\{.*\})<\/check>/s.exec(original)?.[1];
    const ids = report ? (JSON.parse(report) as { issues: { severity: string; node_id?: string }[] }).issues.filter((issue) => issue.severity === "error" && issue.node_id).map((issue) => issue.node_id!) : [];
    return ids.length ? [text("The check found a problem; removing it."), ...[...new Set(ids)].map((element_id) => use("delete_element", { element_id }))] : [text("I could not fix what the check reported.")];
  }
  // Single-request edits the eval asks for, done the way the prompt and guides say. Ids and times come
  // from the <project_state>, <check> and <clip_context> that arrive with the request.
  const stateJson = /<project_state>(\{.*?\})<\/project_state>/s.exec(original)?.[1];
  const project = stateJson ? (JSON.parse(stateJson) as { duration?: number; elements?: { id: string; tag: string; label?: string }[] }) : {};
  const masterId = project.elements?.find((item) => item.tag === "video" && item.label === "assets/master.mp4")?.id;
  const spoken = (words: string) => {
    for (const match of original.matchAll(/\[([\d.]+)–([\d.]+)\] ([^\n<]+)/g)) if (match[3]!.toLowerCase().includes(words)) return Number(match[1]);
    return null;
  };
  if (/b-roll from the library/.test(ask) && !/side by side/.test(ask)) {
    return [text("Finding the line and the footage."), use("search_transcript", { query: "better hooks" }), use("list_library", {})];
  }
  if (/hook title/.test(ask)) {
    const said = /says?:\s*([^.<]+)/i.exec(original.split(/<clip_context>|<project_state>/)[0]!)?.[1]?.trim() ?? "Watch this";
    return [
      text("Adding a bold hook that pops in."),
      use("insert_node", {
        parent_id: "scene0",
        node: { kind: "text", text: said, start: 0, end: 3, x: 0, y: 260, width: 1080, height: 240, textAlign: "center", textBaseline: "middle", fontSize: 84, fontWeight: 800, color: "#FFFFFF", animations: [{ type: "fade", phase: "in", duration: 0.3 }] },
      }),
    ];
  }
  if (/caption style/.test(ask) && /classic/.test(ask)) {
    const yellow = /yellow/.test(ask);
    return [text("Switching the captions to classic."), use("set_caption_style", { preset: "classic", ...(yellow ? { colors: ["#FFD400"], highlight: "block" } : {}) })];
  }
  if (/punch-in zoom/.test(ask) && masterId) {
    const at = spoken("first three seconds") ?? 2;
    return [
      text("Punching in on that line."),
      use("set_keyframe", { element_id: masterId, property: "scale", time: at, value: 1 }),
      use("set_keyframe", { element_id: masterId, property: "scale", time: at + 0.3, value: 1.15 }),
      use("set_keyframe", { element_id: masterId, property: "scale", time: at + 2.3, value: 1.15 }),
      use("set_keyframe", { element_id: masterId, property: "scale", time: at + 2.6, value: 1 }),
    ];
  }
  if (/problems/.test(ask) && /fix/.test(ask)) {
    const report = /<check>(\{.*?\})<\/check>/s.exec(original)?.[1];
    const ids = report ? [...new Set((JSON.parse(report) as { issues: { node_id?: string; code: string }[] }).issues.filter((issue) => issue.node_id && issue.code !== "caption-overlap").map((issue) => issue.node_id!))] : [];
    return ids.length ? [text("The check flags layers nobody can see; removing them."), ...ids.map((element_id) => use("delete_element", { element_id }))] : [text("The check found nothing to fix.")];
  }
  if (/^\s*make it better\b/.test(ask)) {
    return [use("ask_user", { question: "What should be better?", options: ["Tighter pacing", "A hook title", "Better captions"], multi: true })];
  }
  if (/call to action/.test(ask) && project.duration) {
    const said = /'([^']+)'/.exec(original)?.[1] ?? "Follow for more";
    return [text("Adding the call to action at the end."), use("add_text", { text: said, start: Math.max(0, project.duration - 2), end: project.duration, y: 0.75, bold: true })];
  }
  if (/uppercase/.test(ask) && /outline/.test(ask)) {
    const title = project.elements?.find((item) => item.tag === "text");
    if (title) {
      return [
        text("Restyling the title."),
        use("set_props", { element_id: title.id, props: { textCase: "upper", fontSize: 96 } }),
        use("add_part", { element_id: title.id, key: "strokes", part: { color: "#000000", width: 8 } }),
      ];
    }
  }
  if (/fade to black/.test(ask) && project.duration) {
    return [
      text("Fading to black over the last second."),
      use("insert_node", {
        parent_id: "scene0",
        node: { kind: "rect", fill: "#000000", x: 0, y: 0, width: 1080, height: 1920, start: project.duration - 1, end: project.duration, animations: [{ type: "fade", phase: "in", duration: 1 }] },
      }),
    ];
  }
  if (/gate test/.test(ask)) {
    // Places an image the library does not have: the check after it reports an error.
    return [text("Adding the logo."), use("insert_node", { parent_id: "scene0", node: { kind: "image", src: "assets/logo.png", x: 40, y: 40, width: 200, height: 200, start: 0, end: 3 } })];
  }
  // Dòng kịch bản trong <clip_context>: model thật đọc chúng để chọn câu trích.
  const lines = [...original.matchAll(/\[[\d.]+–[\d.]+\] ([^\n<]+)/g)].map((match) => match[1]!.trim());
  const lineWith = (word: string) => lines.find((line) => line.toLowerCase().includes(word)) ?? lines[1] ?? lines[0] ?? "";
  const quoted = /'([^']{4,})'/.exec(original.split(/<clip_context>|<project_state>/)[0]!)?.[1];
  // Slash commands: the directive names the tool; the words after the command are the request.
  const words = (original.split(/<command|<clip_context>|<project_state>/)[0] ?? "").replace(/^\s*\/[a-z]+\s*/i, "").trim();
  // A whole video: /video, or "make a … video" on a blank New edit (nothing spoken), as the system
  // prompt tells a real model to route it.
  const blankEdit = original.includes("no_script");
  if (/<command name="\/video">/.test(ask) || (blankEdit && /\b(make|create)\b[^.]*\bvideo\b/.test(ask))) {
    // The length and frame the user asked for, as a real model passes them; 15 s and the edit's frame otherwise.
    const asked = /(\d{1,3})\s*-?\s*(?:seconds?|secs?|s)\b/i.exec(words)?.[1];
    const aspect = /\bsquare\b|\b1:1\b/i.test(words) ? "1:1" : /\blandscape\b|\bhorizontal\b|\b16:9\b/i.test(words) ? "16:9" : undefined;
    return [
      text("I'll have the director plan the video."),
      use("create_video", { prompt: words || "a short product video", seconds: asked ? Number(asked) : 15, ...(aspect ? { aspect } : {}) }),
    ];
  }
  // /explain: the storyboard first, as the guide says; the code only after the user says go, or
  // straight away when the user already said so ("go ahead", "no need to show it").
  if (/<command name="\/explain">/.test(ask)) {
    const explainer = explainerFor(ask);
    if (/\bgo ahead\b|\bjust (do|make) it\b|no need to (show|ask)/.test(ask)) {
      return [text("Writing the animation and previewing it."), use("preview_explainer", explainerInput(explainer))];
    }
    const look = [explainer.theme, explainer.personality].filter(Boolean).join(", ");
    const beats = explainer.beats.map((beat, index) => `${index + 1}. ${beat.say}${beat.label ? ` [${beat.label}]` : ""}\n   Picture: ${beat.visual}`).join("\n");
    return [text(`${EXPLAINER_SCRIPT} — “${explainer.title}”${look ? ` (${look})` : ""}:\n${beats}\n\nShall I make it?`)];
  }
  if (/<command name="\/roughcut">/.test(ask) && !/just do it/.test(ask)) {
    return [text(`${ROUGHCUT_PLAN}: I'll cut the earlier takes of repeated sentences and keep the last one, remove the filler sounds, and trim pauses over 0.6 s to about 0.3 s. Laughs, dramatic pauses and the call to action stay. Shall I cut it?`)];
  }
  if (roughcutRun(history)) {
    return [text("Finding the retakes and the fillers."), use("find_retakes", {}), use("find_filler_words", {})];
  }
  const proposed = history.some(
    (message) => message.role === "assistant" && (message.content as Block[]).some((block) => block.type === "text" && block.text?.startsWith(EXPLAINER_SCRIPT)),
  );
  if (proposed && /^\s*(go|yes|ok|make it)\b/.test(ask)) {
    return [text("Writing the animation and previewing it."), use("preview_explainer", explainerInput(explainerFor(explainAsk(history))))];
  }
  if (/<command name="\/image">/.test(ask)) {
    return [
      text("I'll create that image."),
      use("generate_media", { kind: "image", idea: words || "the product at work", subject: "a laptop on a hotel desk", setting: "a bright lobby", style: "photo", start: 0, length: 3 }),
    ];
  }
  // Trước "square": "export it, also as a square copy" là một lượt export, không phải đổi khung.
  if (/\bexport/.test(ask)) {
    return [text("Exporting it, with a square copy for the feed."), use("request_export", { frames: ["9:16", "1:1"] })];
  }
  if (/feedback/.test(ask)) {
    return [
      text("I can't do that yet, so I'm reporting it."),
      use("send_feedback", { category: "missing_capability", summary: "User asked for a feature the editor does not have yet.", severity: "low" }),
    ];
  }
  if (/check/.test(ask) && /square/.test(ask)) {
    return [text("Making it square, then checking the frame."), use("set_frame", { width: 1080, height: 1080 }), use("capture", { times: [1] })];
  }
  if (/check/.test(ask)) return [text("Let me look at the clip."), use("capture", { times: [1, 2] })];
  if (/\bask\b/.test(ask)) {
    return [use("ask_user", { question: "Which caption style do you want?", options: ["Classic", "Spotlight"], multi: false })];
  }
  if (/silence|pause/.test(ask)) return [text("Looking for long pauses."), use("find_silences", {})];
  if (/\bplan\b/.test(ask)) {
    return [use("update_plan", { items: [{ text: "Add a hook title", status: "active" }, { text: "Check the frame", status: "pending" }] })];
  }
  if (/library/.test(ask)) return [use("list_library", {})];
  if (/listen/.test(ask)) return [use("media_waveform", {})];
  if (/lint/.test(ask)) return [use("check", {}), use("read_guide", { name: "workflow" })];
  if (/expensive/.test(ask)) return [text("Working hard."), use("get_project_state", {})];
  if (/caption the b-?roll|translate the captions/.test(ask)) return [text("Finding the layer."), use("get_document", {})];
  if (/square|1:1/.test(ask)) return [text("Switching the clip to a square frame."), use("set_frame", { width: 1080, height: 1080 })];
  if (/vertical|9:16/.test(ask)) return [text("Switching back to vertical."), use("set_frame", { width: 1080, height: 1920 })];
  if (/repurpose/.test(ask)) {
    // Kịch bản MỚI (không chép câu người nói): nhắc lại ý bằng lời của mình.
    const topic = (lines[0] ?? "this idea").split(" ").slice(0, 6).join(" ").replace(/[.,!?]+$/, "");
    const script = `Here is the short version. ${topic}: that is the whole point. Try it today and see what changes.`;
    return [text("I'll replace the voice with a new script."), use("add_voiceover", { text: script, voice: "Test A", mode: "replace" })];
  }
  if (/voice-?over|narrat/.test(ask)) {
    return [text("I'll add a voice-over."), use("generate_media", { kind: "voice", prompt: "Welcome back. Here is the one habit that changed everything." })];
  }
  if (/b-roll shot/.test(ask)) {
    // Brief từ câu người nói, không phải chủ đề tự nghĩ ra.
    return [
      text("I'll brief an AI shot for that line."),
      use("generate_media", {
        kind: "video",
        quote: quoted ?? lineWith("numbers"),
        idea: "results start to grow once the hook works",
        subject: "a creator watching the view counter climb on a phone",
        action: "smiling as the phone lights up",
        setting: "a small home studio at night",
        style: "cinematic",
        camera: "slow push-in",
      }),
    ];
  }
  if (/save a frame/.test(ask)) return [text("Saving a clean frame to the library."), use("save_frame", { time: 1, name: "before-cut" })];
  if (/generate b-roll:/.test(ask)) {
    // Starter B-roll (guide broll): bỏ câu đầu (hook) và câu cuối, ảnh tĩnh trước, cùng một lượt.
    let picks = lines.slice(1, -1).filter((line) => line.split(" ").length >= 4).slice(0, 3);
    // Clip rất ngắn (một dòng): tách đôi câu dài thành hai shot, cả hai vẫn là lời có thật.
    if (picks.length < 2) {
      const words = (lines.find((line) => line.split(" ").length >= 6) ?? "").split(" ");
      if (words.length >= 6) picks = [words.slice(0, Math.floor(words.length / 2)).join(" "), words.slice(Math.floor(words.length / 2)).join(" ")];
    }
    return [
      text(`I'll start with ${picks.length} stills; you approve them together.`),
      ...picks.map((line) =>
        use("generate_media", {
          kind: "image",
          quote: line.split(" ").slice(0, 6).join(" "),
          idea: "show what the speaker talks about",
          subject: "a creator at a desk with a phone and a notebook",
          setting: "a bright home office",
          style: "photo",
          length: 2.5,
          variants: 3,
        }),
      ),
    ];
  }
  if (/look like night/.test(ask)) {
    return [text("I'll turn that part of your video into a night scene."), use("edit_video", { start: 2, end: 6, prompt: "night time, warm desk lamp, city lights through the window" })];
  }
  if (/replace the background/.test(ask)) {
    return [text("I'll swap the room behind you for a bright office."), use("replace_background", { start: 2, end: 6, background: "a bright modern office with plants, soft morning light" })];
  }
  if (/\bintro\b/.test(ask)) {
    return [text("I'll have the video team plan an intro."), use("plan_video", { recipe: "intro", brief: "confident, clean, brand colours" })];
  }
  const at = /ai image at (\d+(?:\.\d+)?)\s*s/.exec(ask);
  if (at) {
    // A project without a script: the shot is placed by time, there is no line to quote.
    return [
      text(`I'll create an image at ${at[1]}s.`),
      use("generate_media", {
        kind: "image",
        idea: "the product at work late at night",
        subject: "a laptop with a booking dashboard on a hotel desk",
        setting: "a dim hotel room",
        style: "cinematic",
        start: Number(at[1]),
        length: 3,
        ...(/variants/.test(ask) ? { variants: 3 } : {}),
      }),
    ];
  }
  if (/generate|create an image|b-roll/.test(ask)) {
    const quote = lineWith("hooks").split(" ").slice(0, 8).join(" ");
    return [
      text("I'll create an image for this clip."),
      use("generate_media", { kind: "image", quote, idea: "a strong opening grabs attention", subject: "a person stopping mid-scroll on their phone", setting: "a busy street", style: "photo" }),
    ];
  }
  if (/3d studio|premium 3d|3d animation/.test(ask)) {
    // Con số của câu được trích (chữ số hoặc số viết bằng chữ) — không bịa số.
    const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const line = quoted ?? lines.find((item) => /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(item)) ?? lines[0] ?? "";
    const token = /(\d[\d,.]*)|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(line);
    const value = token?.[1] ? Number(token[1].replace(/,/g, "")) : NUMBERS[(token?.[2] ?? "three").toLowerCase()]!;
    const quote = line.split(" ").slice(0, 6).join(" ");
    const code = sceneCode(
      quote,
      `const counter = kit.counter(${value}, { size: 1.2 });\nkit.label('seconds to hook', { size: 0.3, at: counter.mesh, lift: 0.3 });\nreturn (t) => { counter.set(kit.phase(t, 0.3, 1.8)); kit.frame({ yaw: 8 + 6 * t / 4, push: t / 4 }); };`,
    );
    return [
      use("update_plan", { items: [{ text: `'${quote}' → 3D number counting up to ${value}`, status: "active" }] }),
      use("preview_3d", { code, duration: 4, aspect_ratio: "1:1" }),
    ];
  }
  if (/3d visual/.test(ask)) {
    // Câu chứa từ khoá dài nhất của câu lệnh ("habits", "growing"…), vài từ đầu làm quote.
    const keys = ask.split(/[^a-z]+/).filter((word) => word.length > 4 && !["visual", "explains", "about", "compounds"].includes(word));
    const key = keys.map((word) => word.replace(/s$/, "")).find((word) => lines.some((item) => item.toLowerCase().includes(word))) ?? "growing";
    const line = lines.find((item) => item.toLowerCase().includes(key)) ?? lineWith("growing");
    const words = line.split(" ");
    const at = Math.max(0, words.findIndex((word) => word.toLowerCase().includes(key)));
    const quote = words.slice(at, at + 4).join(" ");
    const code = sceneCode(
      quote,
      "const bars = kit.bars([1, 2, 4, 8], { showValues: false });\nkit.label('Compounds', { size: 0.4, at: bars.group, lift: 0.7 });\nreturn (t) => { bars.grow(kit.phase(t, 0.2, 2.2)); kit.frame({ yaw: 12 + t, push: t / 4 }); };",
    );
    return [
      use("update_plan", { items: [{ text: `'${quote}' → 3D bars doubling`, status: "active" }] }),
      use("preview_3d", { code, duration: 4, aspect_ratio: "1:1" }),
    ];
  }
  if (/more visual/.test(ask)) {
    return [
      use("update_plan", { items: [{ text: "[6s] 'better hooks' → icon", status: "active" }, { text: "[16s] 'start with the result' → diagram", status: "pending" }] }),
      use("add_icon", { quote: "you need better hooks", name: "fish", motion: "pop" }),
      use("add_diagram", { quote: "start with the result then show how you got there", nodes: [{ label: "Result" }, { label: "How you got there" }], layout: "column" }),
    ];
  }
  if (/side by side with/.test(ask)) return [text("Looking for B-roll."), use("list_library", {})];
  if (/cinematic/.test(ask)) return [text("Reading the project first."), use("get_project_state", {})];
  if (/filler/.test(ask)) {
    // "the second video": the other video in speech_sources, by its id, as a real model reads it.
    const context = /<clip_context>(\{.*?\})\n/s.exec(original)?.[1];
    const sources = context ? ((JSON.parse(context) as { speech_sources?: { id: string; main?: boolean }[] }).speech_sources ?? []) : [];
    const other = /second video/.test(ask) ? sources.find((source) => !source.main)?.id : undefined;
    return [text("Looking for filler words."), use("find_filler_words", other ? { element_id: other } : {})];
  }
  // Before the plain "title" route: a name tag is add_title on the line where the speaker introduces themselves.
  if (/introduce myself|name tag|lower third/.test(ask)) {
    const said = original.split(/<clip_context>|<project_state>/)[0]!;
    const who = /\b[Ii]'?m ([A-Z][\p{L}-]*)(?:,\s*([^.<\n]+))?/u.exec(said);
    const name = who?.[1] ?? "Your name";
    const role = who?.[2]?.trim();
    const intro = lines.find((line) => line.toLowerCase().includes(name.toLowerCase())) ?? lines[0] ?? "";
    return [
      text("Adding a name tag when you introduce yourself."),
      use("add_title", { kind: "lowerThird", title: name, ...(role ? { sub: role[0]!.toUpperCase() + role.slice(1) } : {}), quote: intro.split(" ").slice(0, 6).join(" ") }),
    ];
  }
  if (/title/.test(ask)) return [use("add_text", { text: "Watch this", start: 0, end: 3 })];
  if (/broken/.test(ask)) return [use("set_frame", { width: 5, height: 1080 })];
  if (/split the screen/.test(ask)) {
    return [
      use("set_layout", { mode: "split-bottom", start: 16, end: 21.5 }),
      use("add_diagram", { nodes: [{ label: "Start with the result" }, { label: "Show how you got there" }], layout: "column", start: 16.2, end: 21 }),
    ];
  }
  if (/\bemoji\b/.test(ask)) {
    return [use("find_lotties", { query: "shock scared lose" }), use("add_lottie", { animation: "emoji/scream", size: 0.25, quote: "people lose viewers" })];
  }
  if (/\bicon\b/.test(ask)) return [use("find_icons", { query: "growth" }), use("add_icon", { name: "trending-up", motion: "pop", start: 2.2, end: 4.5 })];
  if (/diagram/.test(ask)) {
    return [use("add_diagram", { nodes: [{ label: "Start with the result" }, { label: "Show how you got there" }], layout: "column", start: 16, end: 21 })];
  }
  if (/\bstat\b/.test(ask)) {
    return [use("add_chart", { type: "stat", data: [{ label: "seconds to hook them", value: 3 }], start: 14, end: 17 })];
  }
  return [text("I can change the frame, captions, cuts and text on this clip.")];
}

/**
 * Kịch bản trang project:
 *   "style"/"caption" → list_clips → apply_to_clips(mọi clip, set_caption_style classic #FFD400)
 *   "hook"            → list_clips → trả lời bằng chữ
 *   còn lại           → trả lời bằng chữ
 * Sau thẻ duyệt: đọc kết quả, nói bao nhiêu clip đã đổi (hoặc bị từ chối).
 */
function projectScript(history: StoredMessage[]): unknown[] {
  const user = [...history].reverse().find((message) => message.role === "user");
  const blocks = (user?.content ?? []) as Block[];
  const results = blocks.filter((block) => block.type === "tool_result");
  // Câu lệnh của lượt: tin nhắn user gần nhất không phải kết quả tool.
  const promptMessage = [...history]
    .reverse()
    .find((message) => message.role === "user" && !(message.content as Block[]).some((block) => block.type === "tool_result"));
  const turnPrompt = ((promptMessage?.content ?? []) as Block[])
    .map((block) => block.text ?? "")
    .join(" ")
    .split("<project_state>")[0]!
    .toLowerCase();

  if (results.length) {
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    const previous = anthropicFormat.callsIn(assistant?.content ?? []).map((call) => call.name);
    const raw = typeof results[0]!.content === "string" ? (results[0]!.content as string) : "{}";
    if (previous.includes("list_clips")) {
      const clips = (JSON.parse(raw) as { untrusted_data?: { clips?: Array<{ id: string; hook: string | null; number: number }> } }).untrusted_data?.clips ?? [];
      if (/hook/.test(turnPrompt)) {
        const best = clips[0];
        return [text(best ? `Clip ${best.number} has the strongest hook: "${best.hook ?? ""}".` : "This project has no clips yet.")];
      }
      return [
        text(`Applying the caption style to ${clips.length} clips.`),
        use("apply_to_clips", {
          clip_ids: clips.map((clip) => clip.id),
          ops: [{ op: "set_caption_style", preset: "classic", colors: ["#FFD400"] }],
        }),
      ];
    }
    if (previous.includes("apply_to_clips")) {
      const parsed = JSON.parse(raw) as { declined?: boolean; results?: Array<{ ok: boolean }> };
      if (parsed.declined) return [text("Okay, I left the clips as they were.")];
      const done = (parsed.results ?? []).filter((item) => item.ok).length;
      return [text(`Updated ${done} of ${(parsed.results ?? []).length} clips.`)];
    }
    return [text("Done.")];
  }

  if (/style|caption|hook/.test(turnPrompt)) return [text("Reading the clips."), use("list_clips", {})];
  return [text("I can change captions, frames and text across the clips in this project.")];
}

/**
 * Kịch bản CMO chat (scope `cmo`, nhận ra nhờ tool `create_task`):
 *   "research"        → search_reddit → create_task sales (brief kèm URL đầu tiên)
 *   "clip"/"video"    → create_task video (mục lịch có nút Make clips)
 *   "plan"            → create_task planner
 *   "draft"/"post"    → create_task x_writer
 *   "calendar"        → list_calendar → nói số mục
 *   "remember"        → remember (phần sau chữ "remember")
 *   còn lại           → trả lời bằng chữ
 */
function cmoScript(history: StoredMessage[]): unknown[] {
  const user = [...history].reverse().find((message) => message.role === "user");
  const blocks = (user?.content ?? []) as Block[];
  const results = blocks.filter((block) => block.type === "tool_result");
  if (results.length) {
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    const previous = anthropicFormat.callsIn(assistant?.content ?? []).map((call) => call.name);
    const raw = typeof results[0]!.content === "string" ? (results[0]!.content as string) : "{}";
    if (previous.includes("search_reddit")) {
      const posts = (JSON.parse(raw) as { untrusted_data?: { url?: string }[] }).untrusted_data ?? [];
      return [
        text(`I found ${posts.length} Reddit posts about this. Handing it to the Sales agent.`),
        use("create_task", { agent: "sales", brief: `People asking for help with this, e.g. ${posts[0]?.url ?? "Reddit"}`, when: "now" }),
      ];
    }
    if (previous.includes("create_task")) {
      const parsed = JSON.parse(raw) as { started?: boolean; scheduled?: boolean; day?: string; error?: string };
      if (parsed.scheduled) return [text(`Added to your calendar for ${parsed.day}. Open it there to make the clips from your own video.`)];
      if (!parsed.started) return [text(`I could not start that: ${parsed.error ?? "unknown error"}`)];
      return [text("On it. The result will show up in the app within a minute, and nothing goes out until you approve it.")];
    }
    if (previous.includes("list_calendar")) {
      const items = (JSON.parse(raw) as { untrusted_data?: { items?: unknown[] } }).untrusted_data?.items ?? [];
      return [text(`You have ${items.length} items on your calendar for the next two weeks.`)];
    }
    if (previous.includes("remember")) return [text("Noted. I will use that in every plan and draft.")];
    return [text("Done.")];
  }
  const ask = blocks.map((block) => block.text ?? "").join(" ").split("<documents>")[0]!.split("<cmo_state>")[0]!;
  const lower = ask.toLowerCase();
  if (/remember/.test(lower)) return [use("remember", { note: ask.replace(/^.*?remember( that)?:?\s*/i, "").trim().slice(0, 200) || ask.trim() })];
  if (/research/.test(lower)) return [text("Looking at Reddit first."), use("search_reddit", { query: "late invoices" })];
  if (/clip|video/.test(lower)) return [text("Adding a video task."), use("create_task", { agent: "video", brief: "Clips about how you onboard a new client", clips: 3, clip_length: "short" })];
  if (/reddit/.test(lower)) return [text("Scanning Reddit for people who need this."), use("create_task", { agent: "sales", brief: "People who struggle with the problem we solve", when: "now" })];
  if (/plan/.test(lower)) return [text("Planning your week."), use("create_task", { agent: "planner", brief: "A balanced week from the content strategy", when: "now" })];
  if (/draft|post/.test(lower)) return [text("Drafting a post for X."), use("create_task", { agent: "x_writer", brief: "A post from the content strategy", when: "now" })];
  if (/calendar/.test(lower)) return [use("list_calendar", {})];
  return [text("I know your product from your documents. Ask me to plan the week or draft a post for X.")];
}

export const fakeProvider: Provider = {
  kind: "fake",
  model: "fake",
  ...anthropicFormat,
  failureMessage: () => "Something went wrong. Please try again.",
  async step({ history, tools }: StepRequest, onDelta: (delta: Delta) => void): Promise<Step> {
    const project = tools.some((tool) => tool.name === "apply_to_clips");
    const cmo = tools.some((tool) => tool.name === "create_task");
    const content = [
      { type: "thinking", thinking: "Deciding which tool fits.", signature: "fake" },
      ...(cmo ? cmoScript(history) : project ? projectScript(history) : script(history)),
    ];
    onDelta({ type: "thinking", text: "Deciding which tool fits." });
    for (const block of content as Array<{ type: string; text?: string; id?: string; name?: string }>) {
      if (block.type === "text") onDelta({ type: "text", text: block.text! });
      if (block.type === "tool_use") onDelta({ type: "tool_start", id: block.id!, name: block.name! });
    }
    const calls: ToolCall[] = anthropicFormat.callsIn(content);
    // "expensive": ~$10 trong một bước — vượt phần giữ 5 credit, lượt phải dừng chờ gia hạn.
    const expensive = calls.some((call) => call.name === "get_project_state") && /expensive/.test(JSON.stringify(history[history.length - 1]?.content ?? ""));
    return {
      content,
      toolCalls: calls,
      stop: calls.length ? "tool" : "end",
      usage: { input: expensive ? 2_000_000 : 1200, output: 80, cacheRead: 0, cacheWrite: 0 },
      model: "fake",
    };
  },
};
