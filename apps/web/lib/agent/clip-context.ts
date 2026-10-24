/**
 * Khối `<clip_context>`: clip nói về gì, theo từng câu và theo giây CLIP (spec
 * visual-grounding). Gắn MỘT lần vào tin nhắn đầu mỗi yêu cầu — không lặp sau
 * từng bước ghi như `<project_state>`, vì kịch bản không đổi trong một lượt
 * trừ khi agent cắt chữ (khi đó nó đọc lại bằng get_transcript).
 *
 * Trước đây agent chỉ thấy danh sách phần tử: muốn biết người nói nói gì nó
 * phải tự gọi get_transcript, và với visual nó hay bỏ qua — ra ảnh/video sinh
 * lạc đề. Giờ kịch bản đi cùng mọi câu lệnh.
 */

import type { ClipDocument } from "@opencmo/clip-doc";
import { activeScene, clipScript, frameRatio, readBrand, clipTranscript, formatScript, loadCaptions, speechOffset, speechSources, summarizeProject, type OpContext } from "@opencmo/editor-core";

import { speechContext, type MediaVideo } from "./speech";

export type ClipAbout = { hook?: string | null; reason?: string | null };

/**
 * `transcribing`: library videos on the timeline whose automatic transcript is still running; they
 * are listed so the agent waits for them instead of paying for captions.
 */
export async function clipContextBlock(
  document: ClipDocument,
  ctx: Pick<OpContext, "readTranscript">,
  about: ClipAbout = {},
  transcribing: MediaVideo[] = [],
): Promise<string> {
  // The script is the master's, else the first video with speech (a New edit with an upload).
  const sources = speechSources(document);
  const primary = sources.find((source) => source.master) ?? sources[0];
  const model = primary ? await loadCaptions(document, ctx, primary.elementId).catch(() => null) : null;
  // A placed video's words are spoken from where it starts on the timeline, not from 0.
  const offset = model && primary && !primary.master ? speechOffset(document, primary.elementId) : 0;
  const lines = model ? clipScript(clipTranscript(model.transcript, model.window, model.removed)).map((line) => ({ ...line, start: line.start + offset, end: line.end + offset })) : [];
  const script = formatScript(lines);
  // A clip with only its own video needs no list: that video is the default of every tool.
  const listed = sources.some((source) => !source.master) || transcribing.length > 0;
  const speech = listed ? await speechContext(document, (src) => ctx.readTranscript(src), transcribing) : [];
  const payload = {
    ...(about.hook ? { title: about.hook } : {}),
    ...(about.reason ? { why_this_clip: about.reason } : {}),
    duration: summarizeProject(document).duration,
    // The videos the transcript tools and cuts take as element_id.
    ...(speech.length ? { speech_sources: speech } : {}),
    // No speaker and no script (a blank "New edit", or AI-only video): media is placed by time,
    // so the agent needs the work area and the guide that explains it.
    ...(model || speech.length ? {} : noScript(document)),
    // The frame shape: without it the agent once asked for 9:16 media on a 16:9 clip (02/10).
    ...(() => {
      const frame = frameRatio(document);
      return frame ? { frame } : {};
    })(),
    // Brand Kit đã áp: visual mới tự lấy màu/font này; chữ agent tự thêm nên theo.
    ...(() => {
      const kit = readBrand(document);
      return kit ? { brand: { colors: kit.colors, heading_font: kit.fonts.heading, body_font: kit.fonts.body, captions: kit.captions.preset } } : {};
    })(),
  };
  return `<clip_context>${JSON.stringify(payload)}\n<script clip_seconds="true">\n${script || "(no transcript)"}\n</script></clip_context>`;
}

function noScript(document: ClipDocument): Record<string, unknown> {
  const workarea = (() => {
    try {
      return (activeScene(document) as { workarea?: [number, number] }).workarea;
    } catch {
      return undefined;
    }
  })();
  return {
    no_script: 'Nothing is spoken in this project. Place media by time (start in seconds), not by quote: read_guide "blank".',
    ...(workarea ? { work_area: workarea } : {}),
  };
}
