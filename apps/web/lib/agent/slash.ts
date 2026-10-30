/**
 * Slash commands of the editor Assistant: a typed shortcut for one capability. The command stays in
 * the user's message as written; the server adds a one-line directive so the model calls that tool
 * and fills its arguments from the rest of the message. (A forced `tool_choice` cannot be combined
 * with the model's thinking, so the directive is the reliable path.)
 */

import type { AiModel } from "@opencmo/editor-core/generate";

import { availableModels } from "@/lib/generate/models";

import { readyStyles } from "./styles";

/**
 * `requires`: the tools the command calls. A command whose tools this clip's Assistant does not
 * have (no model for it on this server, or a blank edit with no speech to cut) is not offered.
 */
export type SlashCommand = { name: string; label: string; hint: string; directive: string | (() => string); requires: string[] };

/** What the panel's menu shows: the command without its directive. */
export type SlashMenuItem = Pick<SlashCommand, "name" | "label" | "hint">;

/**
 * `/style <name>`: offered only while at least one style has every capability it needs, so the menu
 * never shows a command that cannot do its job.
 */
const STYLE_COMMAND: SlashCommand = {
  name: "style",
  label: "Apply a style",
  hint: "A whole look: hook title, captions, punch-ins, proof",
  directive:
    'read_skill the style the user names (one of <styles>; if they name none, pick the one that fits and say which), then follow the steps it returns',
  requires: ["read_skill"],
};

const styleReady = readyStyles().length > 0;

/** The music model, not the first audio model: that one makes short sound effects. */
export function musicModel(models: readonly AiModel[] = availableModels()): string | null {
  const audio = models.filter((model) => model.kind === "audio");
  return (audio.find((model) => /music/.test(model.id)) ?? audio[0])?.id ?? null;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "video", label: "Create a video", hint: "A full AI video: keyframes first, then the shots between them", directive: "call create_video", requires: ["create_video"] },
  { name: "image", label: "Create an image", hint: "An AI image on the clip", directive: 'call generate_media with kind "image"', requires: ["generate_media"] },
  { name: "animate", label: "Animate an image", hint: "Turn the selected image into a short video", directive: 'call generate_media with kind "video" and start_image = the selected AI or uploaded image (list_library if needed)', requires: ["generate_media"] },
  { name: "background", label: "Replace the background", hint: "Keep yourself, change the room behind you", directive: "call replace_background", requires: ["replace_background"] },
  { name: "edit", label: "Edit your video", hint: "Change the look of a part of your video with words", directive: 'read_guide "edit", then call edit_video', requires: ["edit_video"] },
  { name: "broll", label: "B-roll pack", hint: "AI B-roll stills with variants", directive: 'read_guide "broll" and follow its AI B-roll steps', requires: ["generate_media"] },
  { name: "intro", label: "Intro", hint: "An animated intro for this clip", directive: "call plan_video with recipe \"intro\"", requires: ["plan_video"] },
  { name: "voiceover", label: "Voice-over", hint: "A voice reading your text", directive: "call add_voiceover", requires: ["add_voiceover"] },
  {
    name: "music",
    label: "Music",
    hint: "A music bed or sound effect",
    directive: () => {
      const model = musicModel();
      return `call generate_media with kind "audio"${model ? ` and model "${model}" for music (another audio model only when they ask for a sound effect)` : ""}`;
    },
    requires: ["generate_media"],
  },
  {
    name: "roughcut",
    label: "Rough cut",
    hint: "Cut retakes, filler and pauses from your talk",
    directive: 'read_guide "roughcut" and follow its steps: propose the cut and ask before cutting',
    requires: ["find_retakes", "remove_words"],
  },
  {
    name: "explain",
    label: "Explain a concept",
    hint: "A narrated animated explainer, 15-90 s",
    directive: 'read_guide "explainer" and follow its steps: choose the art direction first (list_motion_styles, get_motion_style; for a new video the user has no look for, preview 2-3 directions with preview_explainer variants and let them pick), then show the storyboard (say, label and visual of every beat) with the direction in one line, and ask before writing any code',
    requires: ["add_explainer"],
  },
  ...(styleReady ? [STYLE_COMMAND] : []),
];

/** The commands whose tools are all in `tools` (the names a scope offers). */
export function slashCommandsFor(tools: readonly string[]): SlashCommand[] {
  const offered = new Set(tools);
  return SLASH_COMMANDS.filter((command) => command.requires.every((tool) => offered.has(tool)));
}

/** The command a prompt starts with, if any (`/video make…`). */
export function slashCommand(prompt: string): SlashCommand | null {
  const match = /^\/([a-z]+)(?:\s|$)/.exec(prompt.trimStart());
  return match ? (SLASH_COMMANDS.find((command) => command.name === match[1]) ?? null) : null;
}

/**
 * Directive added to the user's turn for a slash command; empty without one. `tools` are the names
 * the turn offers: a command typed where its tools are missing is answered, not attempted.
 */
export function slashDirective(prompt: string, tools: readonly string[]): string {
  const command = slashCommand(prompt);
  if (!command) return "";
  if (!slashCommandsFor(tools).includes(command)) {
    return `<command name="/${command.name}">The user chose /${command.name}, which is not available here. Say so in one sentence and offer what you can do instead.</command>\n`;
  }
  const directive = typeof command.directive === "function" ? command.directive() : command.directive;
  return `<command name="/${command.name}">The user chose /${command.name}: ${directive} for this request, with arguments taken from their words. Ask only if something required is missing.</command>\n`;
}
