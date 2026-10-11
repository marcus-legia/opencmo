/**
 * Slash commands of the editor Assistant: a typed shortcut for one capability. The command stays in
 * the user's message as written; the server adds a one-line directive so the model calls that tool
 * and fills its arguments from the rest of the message. (A forced `tool_choice` cannot be combined
 * with the model's thinking, so the directive is the reliable path.)
 */

export type SlashCommand = { name: string; label: string; hint: string; directive: string };

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "video", label: "Create a video", hint: "A full AI video from a prompt", directive: "call create_video" },
  { name: "image", label: "Create an image", hint: "An AI image on the clip", directive: 'call generate_media with kind "image"' },
  { name: "animate", label: "Animate an image", hint: "Turn the selected image into a short video", directive: 'call generate_media with kind "video" and start_image = the selected AI or uploaded image (list_library if needed)' },
  { name: "background", label: "Replace the background", hint: "Keep yourself, change the room behind you", directive: "call replace_background" },
  { name: "broll", label: "B-roll pack", hint: "AI B-roll stills with variants", directive: 'read_guide "broll" and follow its AI B-roll steps' },
  { name: "intro", label: "Intro", hint: "An animated intro for this clip", directive: "call plan_video with recipe \"intro\"" },
  { name: "voiceover", label: "Voice-over", hint: "A voice reading your text", directive: "call add_voiceover" },
  { name: "music", label: "Music", hint: "A music bed or sound effect", directive: 'call generate_media with kind "audio"' },
];

/** The command a prompt starts with, if any (`/video make…`). */
export function slashCommand(prompt: string): SlashCommand | null {
  const match = /^\/([a-z]+)(?:\s|$)/.exec(prompt.trimStart());
  return match ? (SLASH_COMMANDS.find((command) => command.name === match[1]) ?? null) : null;
}

/** Directive added to the user's turn for a slash command; empty without one. */
export function slashDirective(prompt: string): string {
  const command = slashCommand(prompt);
  if (!command) return "";
  return `<command name="/${command.name}">The user chose /${command.name}: ${command.directive} for this request, with arguments taken from their words. Ask only if something required is missing.</command>\n`;
}
