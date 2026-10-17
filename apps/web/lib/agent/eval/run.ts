/**
 * Chạy eval của agent editor (spec agent-editor §6):
 *
 *   npm run agent:eval -- --provider fake                 # CI: kiểm harness, không tốn tiền
 *   npm run agent:eval -- --provider anthropic --yes      # model thật: TỐN TIỀN API
 *   npm run agent:eval -- --provider anthropic --task hook --yes
 *   npm run agent:eval -- --provider anthropic --yes --until-card --task video-
 *   CMO_LLM_PROVIDER=gemini npm run agent:eval -- --provider gemini --yes   # Gemini, sub-agents too
 *
 * `--until-card` stops a task at the first price card (what the user would approve), so a real
 * model costs only its own tokens and the director's, never media credits. `--task video-` runs
 * every task whose id starts with "video-".
 *
 * Comparing runs (same report format as `cmo:eval`, `lib/eval/compare.ts`):
 *   --epochs N     run every task N times; the comparison uses each task's majority
 *   --compare p    pair with an earlier `eval-report.json`: McNemar exact, BETTER / WORSE / INCONCLUSIVE
 *   --max-usd X    stop starting tasks once X USD is spent (also EVAL_MAX_USD)
 *
 * Mỗi bài: workspace trong bộ nhớ từ clip mẫu → cùng system prompt, cùng bộ
 * tool, cùng `runTool` với app; tool tab chạy bằng Node (`node-tools.ts`);
 * `ask_user` được trả lời bằng câu soạn sẵn của bài. Chấm bằng code
 * (`tasks.ts`), ghi báo cáo + contact sheet cuối vào `--out`.
 *
 * Model thật cần khoá trong env (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) và
 * `--yes`: không có `--yes` thì chỉ in ước lượng chi phí rồi thoát.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { planStudio3d, planVoiceover, quoteRange, readCaptionState, speechSources, summarizeProject, type Transcript } from "@opencmo/editor-core";

import { promptVersion } from "@/lib/cmo/jobs/edit-taxonomy";
import type { CaseResult, EvalReport } from "@/lib/eval/compare";
import { priceOf, type Price } from "@/lib/eval/prices";
import { gitInfo, printComparison, writeReport } from "@/lib/eval/report";

import { clipContextBlock } from "../clip-context";
import { KEEP_IMAGES } from "../limits";
import { SYSTEM_PROMPT, projectStateBlock } from "../prompt";
import { ANTHROPIC_MODEL, anthropicProvider } from "../providers/anthropic";
import { fakeProvider } from "../providers/fake";
import { GEMINI_MODEL, geminiKey, geminiProvider } from "../providers/gemini";
import type { Image, Provider, StoredMessage, ToolResult } from "../providers/types";
import { backgroundToolSpec, prepareBackground } from "../background-tool";
import { editToolSpec, prepareEdit } from "../edit-tool";
import { createVideoToolSpec, prepareCreateVideo } from "../create-video";
import { slashDirective } from "../slash";
import { PLAN_VIDEO_TOOL, prepareVideo } from "../video-team";
import { explainerCard, explainerToolSpecs, prepareExplainer, runPreviewExplainer } from "../explainer-tool";
import { previewMotion } from "@/lib/motion/preview";
import { generateCard, generateToolSpec, prepareGeneration, prepareScene, prepareVoiceover, sceneToolSpec, voiceoverToolSpec, type PreparedGeneration } from "../generate-tool";
import { BROWSER_INPUTS, OWN_VIDEO_TOOLS, TOOL_SPECS, VERIFY_GATE, applyOpTool, checkErrorKeys, failingCheck, isWriteTool, runCheck, runTool } from "../tools";
import { memoryWorkspace } from "../workspace";
import { WAIT_TOOL_SPEC, waitReport } from "../wait-tool";
import {
  FIXTURE_ABOUT,
  FIXTURE_DURATIONS,
  FIXTURE_FILES,
  FIXTURE_MASTER,
  FONTS_DIR,
  TRANSCRIPT,
  fixtureDocument,
  fixtureManifest,
} from "./fixture";
import { nodeCapture, nodeGrab, nodeInspectColor, nodePreview3d, nodeWaveform, type NodeMedia } from "./node-tools";
import { runCmoTasks } from "./cmo-run";
import { CMO_TASKS } from "./cmo-tasks";
import { TASKS, type EvalTask } from "./tasks";

type Args = { provider: string; task?: string; out: string; maxSteps: number; yes: boolean; untilCard: boolean; epochs: number; compare: string | null; maxUsd: number | null };

function args(): Args {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    provider: value("--provider") ?? "fake",
    task: value("--task"),
    out: value("--out") ?? join(process.cwd(), ".agent-eval"),
    maxSteps: Number(value("--max-steps") ?? 60),
    yes: argv.includes("--yes"),
    untilCard: argv.includes("--until-card"),
    epochs: positive("--epochs", value("--epochs")) ?? 1,
    compare: value("--compare") ? resolve(value("--compare")!) : null,
    maxUsd: positive("--max-usd", value("--max-usd") ?? process.env.EVAL_MAX_USD),
  };
}

function positive(flag: string, raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number, got "${raw}".`);
  if (flag === "--epochs" && !Number.isInteger(n)) throw new Error("--epochs needs a whole number.");
  return n;
}

/** Price per million tokens (USD) of the model each provider runs the Assistant on; the fake one is free. */
function priceFor(provider: string): Price {
  if (provider === "fake") return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return priceOf(provider === "gemini" ? GEMINI_MODEL : ANTHROPIC_MODEL);
}

function providerFor(name: string): Provider {
  if (name === "fake") return fakeProvider;
  if (name === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error("ANTHROPIC_API_KEY chưa có trong env.");
    return anthropicProvider();
  }
  if (name === "gemini") {
    if (!geminiKey()) throw new Error("GEMINI_API_KEY is not set.");
    return geminiProvider(geminiKey());
  }
  throw new Error(`provider lạ: ${name}`);
}

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

async function runTask(task: EvalTask, provider: Provider, options: Args) {
  const document = fixtureDocument();
  task.setup?.(document);
  const workspace = memoryWorkspace(
    { version: 1, document, manifest: fixtureManifest() },
    { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": task.transcript ?? TRANSCRIPT, ...task.transcripts }, master: FIXTURE_MASTER },
  );
  // Transcript renderer cần (bản gốc và bản sau cắt do op lưu) — nạp lại trước mỗi lần vẽ.
  const cache = new Map<string, Transcript>();
  const media = (): NodeMedia => ({ files: FIXTURE_FILES, durations: FIXTURE_DURATIONS, transcripts: cache as never, fontsDir: FONTS_DIR });
  const refreshTranscripts = async () => {
    const snapshot = workspace.snapshot();
    const ctx = await workspace.opContext(snapshot.document, snapshot.manifest);
    cache.clear();
    for (const src of ["assets/transcript.json", ...JSON.stringify(snapshot.document).match(/assets\/transcripts\/[^"]+/g) ?? []]) {
      const found = ctx.media?.transcript?.(src);
      if (found) cache.set(src, found as unknown as Transcript);
    }
  };

  const state = async () => {
    const snapshot = workspace.snapshot();
    const report = await runCheck(workspace);
    const check = report.issues.length ? `<check>${JSON.stringify({ ok: report.ok, issues: report.issues.slice(0, 20) })}</check>` : "<check>ok</check>";
    return `${projectStateBlock({ version: snapshot.version, ...summarizeProject(snapshot.document) })}${check}`;
  };

  // Như session.ts: kịch bản clip gắn vào câu lệnh đầu, rồi mới tới trạng thái.
  const start = workspace.snapshot();
  const about = await clipContextBlock(start.document, await workspace.opContext(start.document, start.manifest), FIXTURE_ABOUT);
  const history: StoredMessage[] = [{ role: "user", content: provider.userTurn(task.prompt, `${slashDirective(task.prompt)}${about}${await state()}`) }];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const tools: string[] = [];
  const calls: { name: string; input: unknown }[] = [];
  const cards: { tool: string; changes: string[]; credits: number }[] = [];
  let steps = 0;
  let stopped = "done";
  let openCheck: string | null = null;
  let gated = false;
  let baseline: Set<string> | undefined;
  let gateUsed = false;
  const env = { workspace };
  // Sinh media trong eval: chuẩn bị + kiểm brief như bản thật (chọn model, câu
  // trích, ghép prompt), đặt khai báo lên clip, KHÔNG gọi model sinh. Catalog
  // giả đủ cho việc đó và không tốn gì.
  process.env.OPENCMO_AI_FAKE ??= "1";
  // Same profile as the app: an edit with no video that has a transcript has no cut-by-words tools.
  const blank = !speechSources((await workspace.read()).document).length;
  const toolSpecs = [...TOOL_SPECS.filter((spec) => !(blank && OWN_VIDEO_TOOLS.has(spec.name))), ...[generateToolSpec(), sceneToolSpec(), voiceoverToolSpec()].filter((spec) => spec !== null), PLAN_VIDEO_TOOL, ...[backgroundToolSpec(), createVideoToolSpec(), editToolSpec()].filter((spec) => spec !== null), WAIT_TOOL_SPEC, ...explainerToolSpecs()];
  const generations: PreparedGeneration[] = [];

  for (;;) {
    if (steps >= options.maxSteps) {
      stopped = "max steps";
      break;
    }
    steps++;
    const step = await provider.step({ history: provider.trimImages(history, KEEP_IMAGES), tools: toolSpecs, system: SYSTEM_PROMPT }, () => undefined);
    usage.input += step.usage.input;
    usage.output += step.usage.output;
    usage.cacheRead += step.usage.cacheRead;
    usage.cacheWrite += step.usage.cacheWrite;
    history.push({ role: "assistant", content: step.content });
    if (!step.toolCalls.length && step.stop !== "refusal" && step.stop !== "max_tokens" && openCheck && !gated) {
      // The app's verify gate (loop.ts): one more step when it finishes with check errors open.
      gated = true;
      gateUsed = true;
      history.push({ role: "user", content: provider.userTurn(VERIFY_GATE, openCheck) });
      continue;
    }
    if (!step.toolCalls.length || step.stop === "refusal" || step.stop === "max_tokens") {
      if (step.stop !== "end" && step.stop !== "tool") stopped = step.stop;
      break;
    }
    if (!baseline && step.toolCalls.some((call) => isWriteTool(call.name))) baseline = checkErrorKeys(await state());
    const results: ToolResult[] = [];
    let wrote = false;
    for (const call of step.toolCalls) {
      tools.push(call.name);
      calls.push({ name: call.name, input: call.input });
      if (call.name === WAIT_TOOL_SPEC.name) {
        // No worker here: every approved piece counts as finished, as it would be after the wait.
        const report = waitReport(generations.map((item) => ({ kind: item.model.kind, status: "done", error: null, spec: item.spec as { prompt?: unknown }, created_at: "" })));
        results.push({ id: call.id, name: call.name, ok: true, content: report.content });
        continue;
      }
      if (call.name === "ask_user") {
        const content = task.answer
          ? JSON.stringify({ user_answer: { choices: [], text: task.answer } })
          : JSON.stringify({ skipped: true, message: "The user skipped the question. Use your best judgement." });
        results.push({ id: call.id, name: call.name, ok: true, content });
        continue;
      }
      if (call.name in BROWSER_INPUTS) {
        const parsed = BROWSER_INPUTS[call.name]!.safeParse(call.input);
        if (!parsed.success) {
          results.push({ id: call.id, name: call.name, ok: false, content: JSON.stringify({ INVALID_INPUT: parsed.error.issues[0]?.message }) });
          continue;
        }
        await refreshTranscripts();
        const input = parsed.data as Record<string, unknown>;
        const snapshot = workspace.snapshot();
        if (call.name === "save_frame") {
          // Eval không có Storage: lưu frame cần thư viện thật của editor.
          results.push({ id: call.id, name: call.name, ok: false, content: JSON.stringify({ error: "save_frame needs the editor (not available in eval)." }) });
          continue;
        }
        const answer =
          call.name === "preview_3d"
            ? await nodePreview3d(input as Parameters<typeof nodePreview3d>[0])
            : call.name === "capture"
            ? await nodeCapture(snapshot.document, media(), input)
            : call.name === "inspect_color"
            ? await nodeInspectColor(snapshot.document, media(), input as { time?: number })
            : call.name === "media_grab"
              ? await nodeGrab(media(), input as { path: string })
              : await nodeWaveform(media(), input, "assets/master.mp4", readCaptionState(snapshot.document)?.window ?? null);
        if ("error" in answer) {
          results.push({ id: call.id, name: call.name, ok: false, content: JSON.stringify({ error: answer.error }) });
          continue;
        }
        const shots = "images" in answer ? (answer.images as string[]) : [];
        const images: Image[] | undefined = shots.length ? shots.map((data) => ({ data, mimeType: "image/jpeg" as const })) : undefined;
        results.push({ id: call.id, name: call.name, ok: true, content: JSON.stringify({ ok: true, ...(answer.data as object) }), images });
        continue;
      }
      if (call.name === "preview_explainer") {
        // Same renderer as the app: the local CLI (OPENCMO_MOTION=local) or Modal.
        const outcome = await runPreviewExplainer(call.input, { preview: previewMotion });
        results.push({ id: call.id, name: call.name, ok: outcome.ok, content: outcome.content, ...(outcome.images ? { images: outcome.images } : {}) });
        continue;
      }
      if (call.name === "add_explainer") {
        const prepared = await prepareExplainer(call.input, {
          previewed: async () => calls.filter((item) => item.name === "preview_explainer").map((item) => String((item.input as { code?: unknown }).code ?? "")).reverse(),
          // Eval has no database: code_ref = sha256, as save_scene_code computes it.
          save: async (code) => createHash("sha256").update(code, "utf8").digest("hex"),
        });
        if (typeof prepared === "string") {
          results.push({ id: call.id, name: call.name, ok: false, content: JSON.stringify({ INVALID_INPUT: prepared }) });
          continue;
        }
        generations.push(prepared);
        const card = explainerCard(prepared, "eval");
        cards.push({ tool: call.name, changes: card.changes, credits: card.credits });
        if (options.untilCard) {
          stopped = "card";
          break;
        }
        const applied = await applyOpTool(prepared.op, env);
        if (applied.version !== undefined) wrote = true;
        results.push({ id: call.id, name: call.name, ok: applied.ok, content: applied.ok ? JSON.stringify({ ok: true, note: "Generation started (eval: not rendered)." }) : applied.content });
        continue;
      }
      if (call.name === "plan_video") {
        // Same team and builder as the app; the storyboard card is approved at once.
        const snapshot = workspace.snapshot();
        const planned = await prepareVideo(call.input, { document: snapshot.document, clipContext: about }, async () => undefined);
        if (typeof planned === "string") {
          results.push({ id: call.id, name: call.name, ok: false, content: JSON.stringify({ INVALID_INPUT: planned }) });
          continue;
        }
        const applied = await applyOpTool(planned.prepared.op as never, env);
        if (applied.version !== undefined) wrote = true;
        results.push({ id: call.id, name: call.name, ok: applied.ok, content: applied.content });
        continue;
      }
      if (call.name === "generate_media" || call.name === "add_3d_scene" || call.name === "add_voiceover" || call.name === "replace_background" || call.name === "create_video" || call.name === "edit_video") {
        const prepared =
          call.name === "create_video"
            ? await (async () => {
                const planned = await prepareCreateVideo(call.input, { document: workspace.snapshot().document }, async () => undefined);
                return typeof planned === "string" ? planned : planned.prepared;
              })()
            : call.name === "edit_video"
            ? await (async () => {
                const snapshot = workspace.snapshot();
                return prepareEdit(call.input, snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest));
              })()
            : call.name === "replace_background"
            ? await (async () => {
                const snapshot = workspace.snapshot();
                return prepareBackground(call.input, snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest));
              })()
            : call.name === "generate_media"
            ? await prepareGeneration(call.input, async (quote) => {
                const snapshot = workspace.snapshot();
                return quoteRange(snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest), quote, { min: 1.5, max: 5 });
              })
            : call.name === "add_voiceover"
              ? await prepareVoiceover(call.input, async (input) => {
                  const snapshot = workspace.snapshot();
                  return planVoiceover(snapshot.document, input, await workspace.opContext(snapshot.document, snapshot.manifest));
                })
              : await prepareScene(
                  call.input,
                  async (input) => {
                    const snapshot = workspace.snapshot();
                    return planStudio3d(snapshot.document, input, await workspace.opContext(snapshot.document, snapshot.manifest));
                  },
                  // Eval không có DB: code_ref = sha256 như save_scene_code.
                  async (code) => createHash("sha256").update(code, "utf8").digest("hex"),
                );
        if (typeof prepared === "string") {
          results.push({ id: call.id, name: call.name, ok: false, content: JSON.stringify({ INVALID_INPUT: prepared }) });
          continue;
        }
        generations.push(prepared);
        const card = generateCard(prepared, "eval");
        cards.push({ tool: call.name, changes: card.changes, credits: card.credits });
        if (options.untilCard) {
          stopped = "card";
          break;
        }
        const applied = await applyOpTool(prepared.op, env);
        if (applied.version !== undefined) wrote = true;
        results.push({ id: call.id, name: call.name, ok: applied.ok, content: applied.ok ? JSON.stringify({ ok: true, note: "Generation started (eval: not rendered)." }) : applied.content });
        continue;
      }
      const outcome = await runTool(call.name, call.input, env);
      if (outcome.version !== undefined) wrote = true;
      results.push({ id: call.id, name: call.name, ok: outcome.ok, content: outcome.content });
    }
    if (stopped === "card") break;
    const after = wrote && step.toolCalls.some((call) => isWriteTool(call.name)) ? await state() : undefined;
    if (after !== undefined) openCheck = failingCheck(after, baseline);
    history.push({ role: "user", content: provider.toolResults(results, after) });
  }

  const final = workspace.snapshot();
  const report = await runCheck(workspace);
  const reply = history
    .filter((message) => message.role === "assistant")
    .flatMap((message) => (message.content as { type?: string; text?: string }[]).filter((block) => block.type === "text").map((block) => block.text ?? ""))
    .join("\n");
  const grade = task.grade({ document: final.document, report, tools, generations, calls, cards, reply, untilCard: options.untilCard });
  await refreshTranscripts();
  const sheet = await nodeCapture(final.document, media(), { count: 8 }).catch(() => null);
  return { task, grade, steps, usage, tools, calls, cards, reply, stopped, gate: gateUsed, sheet: sheet?.images[0] ?? null, document: final.document };
}

async function main() {
  const options = args();
  // "video-" (ending in a dash) runs every task of that group.
  const selected = (id: string) => !options.task || (options.task.endsWith("-") ? id.startsWith(options.task) : id === options.task);
  const tasks = TASKS.filter((task) => selected(task.id));
  // CMO chat memory-safety (`cmo-run.ts`): the app's turn loop on a recording client, graded on its tool calls.
  const cmoTasks = CMO_TASKS.filter((task) => selected(task.id));
  if (!tasks.length && !cmoTasks.length) throw new Error(`No task ${options.task}.`);
  const price = priceFor(options.provider);

  if (options.provider !== "fake" && !options.yes) {
    // Ước lượng thô: ~15 bước/bài, ~30k token vào mỗi bước (80% trúng cache), ~1.5k ra.
    const perStep = (6_000 * price.input + 24_000 * price.cacheRead + 1_500 * price.output) / 1e6;
    const runs = tasks.length * options.epochs;
    console.log(`Estimate: ${runs} task runs × ~15 steps × ~$${perStep.toFixed(3)} ≈ $${(runs * 15 * perStep).toFixed(2)} (at most ${options.maxSteps} steps a task${options.maxUsd ? `, stops after $${options.maxUsd}` : ""}).`);
    console.log("Add --yes to run it.");
    return;
  }

  // The fake model drives the fake Video agent team too, so the eval stays offline and free.
  if (options.provider === "fake") process.env.OPENCMO_AGENT_FAKE ??= "1";
  const provider = providerFor(options.provider);
  mkdirSync(options.out, { recursive: true });
  type Row = { task: string; epoch: number; pass: boolean; steps: number; stopped: string; seconds: number; calls: number; input: number; cached: number; output: number; gate: boolean; cost: number; notes: string };
  const rows: Row[] = [];
  const cases: CaseResult[] = [];
  const started_at = new Date().toISOString();
  let spent = 0;
  let skipped = 0;
  for (let epoch = 0; epoch < options.epochs; epoch++) for (const task of tasks) {
    // The cap stops new tasks, never one in progress.
    if (options.maxUsd !== null && spent >= options.maxUsd) {
      skipped += 1;
      continue;
    }
    const started = Date.now();
    const result = await runTask(task, provider, options);
    const cost = (result.usage.input * price.input + result.usage.output * price.output + result.usage.cacheRead * price.cacheRead + result.usage.cacheWrite * price.cacheWrite) / 1e6;
    spent += cost;
    const file = options.epochs > 1 ? `${task.id}.${epoch}` : task.id;
    if (result.sheet) writeFileSync(join(options.out, `${file}.jpg`), Buffer.from(result.sheet, "base64"));
    writeFileSync(join(options.out, `${file}.json`), JSON.stringify({ tools: result.tools, calls: result.calls, cards: result.cards, reply: result.reply, grade: result.grade, document: result.document }, null, 2));
    cases.push({ id: task.id, epoch, pass: result.grade.pass, decided_by: "code", ...(result.grade.notes.length ? { notes: result.grade.notes } : {}), cost_usd: cost });
    const row: Row = {
      task: task.id,
      epoch,
      pass: result.grade.pass,
      steps: result.steps,
      stopped: result.stopped,
      seconds: Math.round((Date.now() - started) / 1000),
      // What the work costs besides money: model calls, tool calls, tokens read (fresh and cached).
      calls: result.tools.length,
      input: result.usage.input,
      cached: result.usage.cacheRead,
      output: result.usage.output,
      gate: result.gate,
      cost: Math.round(cost * 1000) / 1000,
      notes: result.grade.notes.join("; "),
    };
    rows.push(row);
    console.log(`${row.pass ? "PASS" : "FAIL"} ${row.task.padEnd(9)} ${String(row.steps).padStart(3)} bước ${String(row.calls).padStart(3)} tools ${String(row.seconds).padStart(4)}s  $${row.cost.toFixed(3)}${row.gate ? "  [verify gate]" : ""}  ${row.notes}`);
    // What the user would see: the card they approve, or the Assistant's answer.
    for (const card of result.cards) console.log(`     card (${card.tool}): ${card.changes[0] ?? ""}`);
    if (!result.cards.length && result.reply) console.log(`     reply: ${result.reply.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  for (let epoch = 0; epoch < options.epochs && cmoTasks.length; epoch++) {
    if (options.maxUsd !== null && spent >= options.maxUsd) {
      skipped += cmoTasks.length;
      continue;
    }
    const results = await runCmoTasks(provider, { epoch, tasks: cmoTasks, log: (line) => console.log(`     ${line}`) });
    for (const result of results) {
      spent += result.cost_usd ?? 0;
      cases.push(result);
      console.log(`${result.pending ? "PEND" : result.pass ? "PASS" : "FAIL"} ${result.id}  $${(result.cost_usd ?? 0).toFixed(3)}${result.notes?.length ? `  ${result.notes.join("; ")}` : ""}${result.pending ? `  (pending: ${result.pending})` : ""}`);
    }
  }
  const cmoCases = cases.filter((result) => cmoTasks.some((task) => task.id === result.id));
  const cmoFailed = cmoCases.filter((result) => !result.pending && result.pass !== true).length;
  const cmoPending = cmoCases.filter((result) => result.pending).length;
  const passed = rows.filter((row) => row.pass).length;
  const total = spent;
  const sum = (key: "steps" | "calls" | "seconds" | "input" | "cached" | "output") => rows.reduce((acc, row) => acc + row[key], 0);
  const totals = { steps: sum("steps"), calls: sum("calls"), seconds: sum("seconds"), input: sum("input"), cached: sum("cached"), output: sum("output") };
  console.log(`\n${passed}/${rows.length} tasks passed · $${total.toFixed(2)} · ${totals.steps} steps, ${totals.calls} tool calls, ${totals.seconds}s · tokens in ${totals.input} (+${totals.cached} cached) out ${totals.output} · report in ${options.out}`);
  if (cmoCases.length) console.log(`CMO chat: ${cmoCases.length - cmoFailed - cmoPending}/${cmoCases.length - cmoPending} passed, ${cmoPending} pending (reported, never fail the run)`);
  if (skipped) console.log(`${skipped} task runs not started: the $${options.maxUsd} cap was reached.`);
  writeFileSync(join(options.out, "report.json"), JSON.stringify({ provider: options.provider, rows, passed, cost: total, totals }, null, 2));
  // The shared format, for --compare and the scheduled eval workflow.
  const report: EvalReport = {
    suite: "agent",
    git: gitInfo(),
    provider: options.provider,
    model: options.provider === "fake" ? null : provider.model,
    prompt_versions: { assistant: promptVersion(SYSTEM_PROMPT) },
    started_at,
    cases,
  };
  writeReport(join(options.out, "eval-report.json"), report);
  if (options.compare) printComparison(options.compare, report);
  if (passed < rows.length || cmoFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
