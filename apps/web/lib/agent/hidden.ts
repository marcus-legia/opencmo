/**
 * Features hidden from the web app, each behind one switch (owner, 2026-11-08: cmo-review-2 plan §2.2).
 *
 * `/video` (`create_video`, the full AI video: storyboard, keyframes, shots, voice, music) is hidden while the AI CMO
 * leads: it is the most expensive and most complex job. Hidden means the web Assistant does not get the tool, the slash
 * menu does not offer it, and the Assistant's prompt and guides do not suggest it. The code, the MCP tool, Studio's
 * `build_video` and the evals keep it. Turning `/video` back on is this one line.
 */
export const CREATE_VIDEO_HIDDEN = true;
