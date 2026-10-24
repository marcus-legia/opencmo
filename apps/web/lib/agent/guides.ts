/**
 * Guide cho agent (spec agent-editor §4, AE4): thứ DS đưa qua `docs/skills` +
 * `reference/`, ở đây viết mới cho document của OpenCMO. Tool `read_guide` trả
 * nguyên văn; không nằm trong system prompt để prompt ngắn và cache ổn định.
 *
 * Tiếng Anh vì model đọc. Guide `document` sinh từ chính schema zod của
 * `@opencmo/clip-doc` — tên prop không thể lệch với thứ validate chấp nhận.
 */

import {
  ANIMATION_TYPES,
  BLEND_MODES,
  CAPTION_PRESETS,
  EFFECT_TYPES,
  NAMED_EASINGS,
  NODE_SHAPES,
  TRACK_PROPERTIES,
  TRANSITION_TYPES,
} from "@opencmo/clip-doc";
import { EXPLAINER_EXAMPLE, EXPLAINER_EXAMPLE_BEATS } from "@opencmo/clip-motion/guide-example";
import { FONTS } from "@opencmo/editor-core";

import { EXPLAINER_MOTION } from "./motion-guide";

/** Prop editor ghi cho chính nó — agent không cần biết. */
const HIDDEN = new Set(["selected", "expanded", "clipHeight", "timeline", "playhead", "marks", "kind", "syncTo"]);

function documentGuide(): string {
  const kinds = Object.entries(NODE_SHAPES)
    .map(([kind, shape]) => `- ${kind}: ${Object.keys(shape.shape).filter((key) => !HIDDEN.has(key)).join(", ")}`)
    .join("\n");
  return `# Project document reference

The clip is a tree: stage > scene(s) > elements. Each element has a stable "id" (read them with get_document). Later children draw on top of earlier ones.

## Coordinates and time
- Units are pixels of the scene (a vertical clip is 1080 wide x 1920 tall). x/y is the TOP-LEFT of the element in its parent's space; width/height its size. rotation is degrees; scale/scaleX/scaleY multiply around the element's center; offsetX/offsetY shift after layout.
- Times are SECONDS. start/end place an element on its parent's timeline. For video/audio, sourceIn/sourceOut pick the part of the file that plays. An element without end lasts as long as its media (or 16s for shapes/text without end — always give text an end).
- Keyframe times (set_keyframe) are in the element's OWN seconds: 0 is the moment the element starts.
- A "sequence" plays its children one after another; a "group" moves children together.

## Element kinds and their properties
${kinds}

## Sub-parts (add_part key -> part fields)
- paints: {type: "solid", color} | {type: "linearGradient"|"radialGradient", rotation?, stops: [{offset 0..1, color}]} | {type: "image"|"video", src, objectFit?: cover|contain|fill}
- strokes: {color, width?, join?: miter|round|bevel, opacity?}
- shadows: {color, blur?, offsetX?, offsetY?, opacity?}
- effects: {type, value} with type one of ${EFFECT_TYPES.join(", ")} (blur in px; brightness/contrast/saturate 0-1 only lower; color grading: exposure in stops -2..2 (0.3 = a bit brighter), vibrance -1..1 (more or less color), temperature -1 cool..1 warm, tint -1 green..1 magenta, vignette 0..1; small values look natural, e.g. exposure 0.3, temperature 0.15). Curves, wheels, hue curves, chroma key, glow, grain and vignette shape take a params object — set them with apply_color (read_guide "color"), not by hand
- animations: {type, phase?: "in"|"out", duration?, delay?} with type one of ${ANIMATION_TYPES.join(", ")}. appearWord/appearChar/scramble/typewriter/wordSlide/highlightPop are for text (and captions). typewriter types the text with a caret; wordSlide slides the words up one after another; highlightPop pops each word in turn in a highlight color ({perWord: seconds per word, default 0.2; color}); without duration they last words × perWord. fade, slideUp, slideDown, slideLeft, slideRight, pop, blur and grow can run per unit on a text element: {unit: "char"|"word"|"line", order?: "first"|"center"|"last"|"random", step?: seconds between two units' starts (0.02-0.5; defaults 0.03 letters, 0.055 words, 0.08 lines), mask?: true (slideUp/slideDown only: each unit rises from behind its line's edge instead of fading)}. Without duration it lasts 0.5 s + step × (units − 1) (0.9 s for lines). Letters for short words (up to about 20 characters), words for a tagline, lines for a paragraph; text over 200 letters animates by word. Captions ignore unit. "in" plays from the element's start, "out" ends at its end.
- ranges (text only): {start, end?, color?, fontWeight?, ...} character indexes into the text, for highlighting words.
- masks: rect nodes; the element shows only inside them.

## Values
- Colors: hex like #FFD400 (8 digits for alpha).
- Animatable properties (set_keyframe): ${TRACK_PROPERTIES.join(", ")}.
- Easings: ${NAMED_EASINGS.join(", ")}, cubicBezier(x1, y1, x2, y2), spring(stiffness, damping), steps(n).
- Transitions (set_props {transition: {type, duration}} on the LEFT clip of a sequence): ${TRANSITION_TYPES.join(", ")}.
- Blend modes: ${BLEND_MODES.join(", ")}.
- Caption presets: ${CAPTION_PRESETS.join(", ")}. Captions also take colors (up to 3 hex), verticalAlign top|center|bottom, offsetY, and fontScale (0.25–3, 1 = preset size) to make the text bigger or smaller. Captions have no width or scale: resize them with fontScale only. Lines wider than the frame wrap automatically.
- Fonts: ${FONTS.join(", ")}. fontWeight 100-900; textCase original|upper|lower; textAlign left|center|right. textAlign only works when the text has BOTH width and height; without them the box shrinks to the text and it starts at x. To center text on a card, give the text the card's x, y, width and height.
- Text style (set_props on text): background {color, paddingX?, paddingY?, radius?, outlineColor?, outlineWidth?, perLine?} draws a box behind the text (perLine: one box per line); decoration ["underline"|"overline"|"strike"]; fill "footage" makes the text a window onto the layers below (the rest of the frame takes the text color) and "inverted" draws it with a difference blend; tiltX/tiltY (-89..89 degrees) lean the text in fake perspective. Flip any element with a negative scaleX/scaleY.
- Elements have no perspective or rotateY: fake a card flip with scaleX keyframes and depth with shadows. For real depth or a camera move, make a motion clip (read_guide "explainer"); generate_media is only for concrete real-world footage.
- volume is dB (0 = as recorded, -60 near silent); muted: true silences.
`;
}

const GUIDES = {
  workflow: `# How to edit a clip

1. Understand the request. If it is ambiguous or would remove a lot of the clip, ask_user once. Otherwise decide.
2. Look before you touch, in ONE step: get_project_state, get_transcript for anything about words or pacing, list_library for media. Then capture a contact sheet (count 6-8) to see what the viewer sees.
3. For anything with more than two steps, write the plan with update_plan and keep it current.
4. Work in this order, because later steps depend on earlier ones:
   a. Story and pacing: cut words, filler and pauses (remove_words, remove_ranges). Cutting changes every later time, so cut FIRST.
   b. Frame: set_frame if the shape changes.
   c. Layers: B-roll (place_broll for library shots, all in one call), titles and hooks (add_text / insert_node), shapes; music and sound effects with insert_asset.
      place_broll and insert_asset put B-roll and audio on a shared row ("B-roll 1", "Audio 1") when the time is free. To tidy layers of the same kind onto one row, move_to_row (clips of another kind are refused).
   d. Motion: keyframes (zoom-ins, pans), animations, transitions.
   e. Captions last: style and colors (set_caption_style), then fix misheard words.
5. Verify: run check and fix every error; then capture frames at the moments you changed (and one before/after) and look at them. Is the speaker in frame? Is every text readable, inside the frame, not covering faces or the captions? Does B-roll start and end where the words say?
6. Finish with one to three sentences about what changed. Never claim something you did not check.

Times after cuts: get_transcript and find_silences use SOURCE seconds; everything on the timeline (add_text, place_broll, insert_asset, capture, keyframes) uses CLIP seconds after cuts. get_project_state shows the kept duration; the captions line up with the clip timeline.`,

  pacing: `# Pacing: filler, pauses, dead air

- Short-form viewers leave in the first seconds. The first sentence should start within 0.3s of the clip start.
- find_filler_words gives candidates: um, uh, repeated words. Remove only true fillers; "like" and "so" are often meaningful — read the line.
- find_silences lists pauses between words with a suggested cut that leaves a natural 0.2s gap. Remove pauses longer than about 0.6s in talking-head clips; keep pauses that are dramatic (after a question, before a punchline).
- media_waveform finds silences the transcript cannot see (breaths, room noise, music). For music with a steady beat it also returns bpm and beats (source seconds): cut and time visuals on beats; the timeline snaps to them too.
- Do not cut more than about a fifth of the clip without asking.
- After cutting, the clip is shorter: re-read get_project_state before placing anything in time.`,

  hooks: `# Hooks and titles

- A hook is a short title on screen during the first 2-3 seconds that makes someone stay: a promise, a number, a question. 3-8 words. Use the speaker's own strongest phrase when possible.
- Place it in the upper third (y about 0.15-0.25 with add_text) so it does not cover the face or the captions (captions sit low by default).
- Make it readable on a phone: fontSize 70-100 on a 1080-wide frame, weight 800, white or a brand color, with a stroke (add_part strokes {color: "#000000", width: 8}) or a shadow for contrast over video.
- Give it motion: an "in" animation (fade, slideUp, grow, appearWord) of 0.3-0.5s, and an "out" fade before it ends.
- Always capture a frame at 1s to confirm it reads well.`,

  titles: `# Titles: name tags, lower thirds, chapters (add_title)

- Name tag or lower third: one per speaker, the first time they appear or introduce themselves. title = the name as they say it, sub = role and company ("Founder, Paylane"). Pass quote = the words where they introduce themselves; it holds 5.5-8 s, long enough to read twice. Never guess a name or role the speaker or the user did not give.
- Chapter titles (kind chapter) where the topic changes in a longer clip: 2-5 words, sub = "Chapter 2" or the episode. Not on a short clip with one idea.
- One title on screen at a time, never on top of a hook title or a diagram. A name tag in the first 2-3 seconds competes with the hook: start it after the hook unless the introduction is the hook.
- Looks: bar for clean interviews, kicker when the role or episode matters, card over busy or bright footage (the panel keeps it readable). Use one look for every title in a clip.
- Placement is automatic: inside title-safe, above the captions, clear of the platform's top bar and bottom buttons on vertical video. Change the side (left/right/center) with update_visual instead of moving it with set_props. check reports text-unsafe for any text in those zones.
- Motion: calm for serious or slow talks, standard by default, punchy for fast edits. Titles move only while they build in (under a second) and out (faster than in); they stay still while read.
- Rhythm for any animated text (titles, add_text, hooks): reveal very short text (up to about 20 characters) by letters, a tagline by words, a paragraph by lines. Gaps between units: letters 0.02-0.04 s, words 0.04-0.07 s, lines 0.06-0.1 s; the whole reveal stays under about 0.8 s, and the exit is quicker than the entrance. Text over busy video needs a panel or a strong shadow behind it.
- Fix a typo or role with update_visual {id, changes: {title, sub}}; do not delete and re-add.
- After adding, capture a frame in the middle of the title: the name readable, accents intact (ễ, ươ), nothing under the captions.`,

  captions: `# Captions

- Presets: classic (one word highlighted at a time, clean), spotlight (bold, colored active word), stark (white boxed), cascade, whisper, paper, guinea. For talking heads on TikTok/Reels, spotlight or classic read best.
- set_caption_style {preset, colors, color?, font?, weight?}: applies to EVERY caption layer of the clip (video and voiceover captions share one style). colors are up to 3 hex values; the preset decides what each color does (usually highlight). color = the main text color, font = one of the editor fonts, weight 100-900; null resets to the preset, leaving a field out keeps it.
- Captions for OTHER media (B-roll, an uploaded talk, a song): uploads are transcribed automatically for free, and a video's transcript is a hidden captions layer linked to it: show it with set_props {hidden: false}. add_captions {element_id} covers the rest (free when the file is already transcribed, otherwise 1 credit/min; the user approves the price). translate_captions {element_id, language} adds a translated copy as a new layer (1 credit/min).
- highlight: "block" (box behind the spoken word) or "pop" (the spoken word grows and turns yellow) with set_props on the captions element; censor: true masks swear words on screen (the transcript keeps them).
- Fix misheard words with edit_words; split long lines with split_line and join short ones with merge_lines.
- Keep captions off faces: they sit at the bottom by default; move them with set_props on the captions element (verticalAlign, offsetY).
- Titles must not overlap the captions: check reports caption-overlap.
- A captions layer on the timeline is not proof the captions show on the video. Before telling the user the clip has captions, run check: captions-empty means the layer shows no words (its transcript could not be loaded, or its sourceIn/sourceOut miss every word), captions-covered means another layer is drawn over them. Tell the user exactly that; never say captions are on screen when check reports either.`,

  script: `# From the script to visuals

<clip_context> holds the clip's script in CLIP seconds. Work from it, not from guesses about the topic.

1. Read the whole script once. Say to yourself in one sentence what the clip argues; every visual must serve that.
2. Mark the beats a picture makes faster: a list of steps, a before/after or A vs B, a number, a trend, a cause and effect, a metaphor ("it compounds", "a snowball"). Skip lines that are just the speaker's opinion or a joke: the face does that best.
3. For each beat pick ONE tool (see the system prompt): drawn visuals for anything abstract or numeric; a motion clip (read_guide "explainer") for a hero moment or a physical metaphor; generate_media only for a concrete scene and only when the user wants AI media.
4. Labels, numbers and steps come from the words of the script, shortened to 1-4 words. Never add a statistic the speaker did not say.
5. Timing: pass quote with the exact words (a few are enough); leave start/end out and the tool times it to the line. Give start/end only to stretch or shorten it.
6. Leave the first line (the hook) on the face. At most one visual on screen; 2-6 seconds each; at least one second of face between visuals.
7. Write the beats to update_plan before you add them: "[12.4s] 'better hooks' → diagram: hook, value, call to action".

AI images and video (generate_media): fill the brief from the script. quote = the line it illustrates; idea = what the viewer should understand; subject/action/setting = a concrete scene that shows that idea without any words in the picture. Pick one style and keep it for every shot in the clip.`,

  broll: `# B-roll

- B-roll covers the speaker with footage that shows what they talk about. Place every library shot in ONE place_broll call: each beat {path, quote} starts on those words from <clip_context> (1.5-4 s), fills the frame (fit "pip" keeps the speaker visible), fades in and out and is muted over the speaker; give start/seconds only to adjust.
- 1.5-4 seconds per shot. Never cover the first sentence (the viewer needs the face to trust the speaker) or the last line.
- Use media_grab first to see what a file shows; pass source_start when the good part is later in the file.
- Keep the B-roll's own sound only when it matters (sound: true).
- A quick scale keyframe (1.0 -> 1.08) on a shot adds motion.
- Capture a frame in the middle of each B-roll shot to confirm.

## AI B-roll (when the user asks to generate B-roll and generate_media is available)

1. Read <clip_context>. Pick 3-5 lines that name something concrete a picture can show (a place, an object, an action). Skip the hook, the last line and opinions. Write them to update_plan: "[12.4s] 'my first store' → a small shop front at dawn".
2. Stills first: call generate_media kind "image" for EVERY shot in the same step (one call per shot, all in one message), so the user approves them on one card with the total price. Same style for every shot; aspect_ratio of the clip frame. length 2-3, so each still already works as a short cutaway. variants 3 on each still (a B-roll pack): the user sees three versions of every shot and keeps the best; say that each variant costs the full price.
3. When they are approved, wait_for_media, then capture a frame on each, tell the user they can pick another variant of any shot in the Inspector (Variants) or by right-clicking it, then ask_user which ones to animate (options: "Animate all", "Keep as stills", or each shot by name). Animation costs much more than a still: say so in the question.
4. Animate the chosen ones: generate_media kind "video" with start_image = that still's library path, the same brief and quote, the shortest duration, length 1.5-4 and muted true — again all in one message, one card. Then delete the still it replaces (delete_element) so the two do not stack.
5. Capture a frame in the middle of each shot; nothing covers the first or last line.

Background music or a sound effect (generate_media kind "audio"): only when the user asks. Music is instrumental only; describe mood, genre and tempo, never an artist or a song. For a bed under the whole clip use the clip length as duration (up to the model's limit), start 0, then set_props volume -18 on it so the speech stays clear.

Same product or character in every shot: when the user has an image of it in the library (an upload or a finished AI image), pass it as references to every image call on a model that lists reference images, and name it in the brief ("the mug from image 1"). Only images the user owns or made: never a real person's face or someone else's logo.

## AI transition (a generated move that bridges a cut)

Use it when the user asks for a smooth/creative transition at a hard cut (a jump cut, or between two B-roll shots), and only with a video model that takes a first AND a last frame.
1. Find the cut at clip second T (capture around it to be sure).
2. save_frame at T - 0.05 (name "before-cut") and at T + 0.05 ("after-cut").
3. generate_media kind "video": start_image = the "before" path, end_image = the "after" path, the shortest duration, start = T - 0.6, length 1.2, fit true (the whole move plays inside 1.2 s and lands on the second picture), muted true. Brief: quote = the words spoken at T, idea "one continuous camera move from the first picture into the second", subject = what both pictures show.
4. After it is placed, capture at T - 0.5, T and T + 0.5: the move covers the cut and ends on the next shot.`,

  jlcut: `# J-cut and L-cut

A straight cut changes picture and sound on the same frame; at a jump between two takes that can feel abrupt. Shift the sound instead:
- L-cut (set_audio_roll seconds > 0): the end of a sentence keeps playing over the start of the next shot. Use it when a thought finishes after the visual change, or to carry a laugh/pause over a cut.
- J-cut (seconds < 0): the next sentence starts under the end of the previous shot, then the picture follows. Use it to lead into a new point or a reaction.
- 0.3-0.8 s is natural; more than 1.5 s sounds like a mistake. Use it on a few key cuts, not every cut.
- get_project_state lists cut_points with the roll each already has. Capture a frame on each side of the cut and listen (media_waveform) to check the overlap does not land in the middle of a word.`,

  roughcut: `# Rough cut (/roughcut): a self-recorded talk, tightened

The user recorded themselves and wants the mistakes out: retakes, false starts, filler and dead air. Keep their words; remove only what a viewer would not miss. When in doubt, keep: a repeat left in costs a second pass, a lost sentence costs the video.

## 1. Look, in ONE step
get_transcript, find_filler_words, find_silences, find_retakes, then one capture contact sheet (count 6). When <clip_context> lists several speech_sources, pass the element_id of the video to cut to every read and every cut (ask which one if the user did not say). Uploaded videos are transcribed automatically and for free, usually within a minute; the editor links the transcript as a hidden captions layer. If a video is still transcribing, say so and wait (wait_for_media) or ask the user to try again in a minute; never pay for it. If it has no transcript at all (no audio, longer than 30 minutes, or over today's free minutes), offer add_captions, which costs nothing when the file already has its transcript.

## 2. Propose in 4-8 sentences, then wait
Say what goes and what stays, with counts and seconds:
- goes: earlier takes of a repeated sentence and false starts (keep the LAST take, it is usually the one the speaker meant), filler sounds (um, uh), pauses over about 0.6 s;
- stays: laughs, a pause after a question or before a punchline, the call to action, "like"/"so"/"you know" when they carry meaning;
- the length now and the estimated length after.
End with "Shall I cut it?" and wait for the user's go, unless they already said to just do it. Never cut more than about a fifth of the clip without saying so in the plan.

## 3. Cut, in this order, one call each
1. Retakes and false starts: ONE remove_words with the drop_word_ids of every retake you agree with. Read each pair in the transcript first: a deliberate repetition ("again: ship it") stays.
2. Fillers: ONE remove_words with the true fillers, tightness "balanced".
3. Silences: remove_silence {min_pause: 0.6, padding: 0.15}, which leaves about 0.3 s. Never leave less than 0.25 s; never cut inside a word.
Each call is one Undo step; the user can undo the whole request in one click.

## 4. Verify before you report
- get_transcript again: every kept sentence still reads from start to end, and no word is cut in half.
- capture at 3-6 of the cut edges: the speaker does not jump mid-gesture in a way that looks like an error.
- Report the length before and after and what was removed (how many takes, fillers, pauses), in two or three sentences.

## 5. Captions last
Style or add captions only after the cutting is finished; a later cut moves every caption.`,

  color: `# Color grading

Use apply_color (one call can set many adjustments on many elements) and check with inspect_color, which measures the frame as exported.
- Order of work, like a colorist: fix exposure and white balance first (inspect_color: black point near 0.02-0.06, white point 0.9-0.98, average RGB close together on neutral scenes), then contrast/curves, then the look (wheels, saturation, hue curves), then texture (sharpen, grain, glow, vignette).
- Correction: exposure ±0.1-0.5 stops; temperature/tint ±0.05-0.2 against a cast; highlights −0.2..−0.5 to recover a bright sky or window; shadows +0.2..+0.4 to open a dark face.
- Looks: warm cinematic = gain [0.06, 0.02, -0.04], lift [-0.02, 0, 0.03] (teal shadows, warm highlights), contrast 0.2, saturation −0.1, grain 0.15, vignette {amount: 0.3}. Clean commercial = shadows 0.15, vibrance 0.2, clarity 0.15, sharpen 0.2. Vintage = blacks 0.15 (faded), saturation −0.25, temperature 0.15, grain 0.35.
- Hue curves pick colors by hue (0 red, 0.08 orange, 0.16 yellow, 0.33 green, 0.5 cyan, 0.66 blue, 0.83 magenta): e.g. sat [[0.33, -0.6]] mutes greens; keep skin (≈0.05-0.1) untouched.
- Chroma key: color = the screen's color (pick it from a capture), range 0.3-0.5, spill 0.5; put the replacement background element BELOW the keyed video.
- A LUT: when the library has a .cube file (list_library, type LUT) and the user wants that look, apply_color lut {path, strength 0.6-1}; adjust exposure and white balance before it, not after.
- Grade every shot of the clip the same unless the user asks otherwise: pass all video element ids at once. Keep skin natural — check a capture of a face after any wheels or hue change.`,

  motion: `# Motion: zoom, pan, animation

- Punch-in on emphasis: on the video element, set_keyframe scale 1 at the start of the phrase and 1.12-1.2 a few frames later (easing snappy or easeOut); set it back at the next sentence. Keyframe times are the ELEMENT's own seconds.
- Slow push: scale 1 -> 1.08 over 3-5s, easing linear or easeInOut.
- Pan: keyframe x. For the main video in a fill frame, x is already keyframed to follow the speaker; do not break that track — prefer scale.
- Text: animations {type: "appearWord"} reveal word by word; "grow"/"slideUp" for titles; always add an "out" phase for titles that end mid-clip.
- Easings: snappy for punches, gentle/easeInOut for drifts, bouncy for playful titles.`,

  reframe: `# Frame and reframe

- set_frame {width, height, mode}: 1080x1920 (9:16, TikTok/Reels/Shorts), 1080x1350 (4:5 feed), 1080x1080 (1:1), 1920x1080 (16:9).
- mode fill crops the source and follows the speaker's face; fit shows the whole source with bars.
- After changing the frame, capture 3-4 frames across the clip: the face must stay inside the frame, and titles/captions may need moving.
- The video's x keyframes ARE the face tracking: the scene mark "reframe" holds where the face is over time, and a pair of keyframes one frame apart is a scene change (a hard cut, not a bug). Do not delete or flatten them; check reports subject-offscreen when the speaker leaves the frame.`,

  layout: `# Layout: split frame, visual-only, and multi-source layouts

- clean_audio {amount, element_id?}: removes steady background noise (hum, fan, room hiss) from the voice when the video is exported; 0.6 suits most voice recordings, omit element_id to clean the clip's own video (all cut pieces). The editor preview still plays the original sound, so tell the user it applies on export.
- set_layout {mode, start, end, ratio} lays the speaker and visuals out together. split-bottom: speaker in the bottom band, a dark panel on top for visuals; split-top: the reverse; visual-only: the panel covers the whole frame while the voice keeps playing (a cutaway); pip: the panel covers the frame and the speaker sits in a rounded square in a corner (anchor top-left/top-right/bottom-left/bottom-right, default bottom-right; ratio = the square's share of the frame width, 0.2-0.5, default 0.36) — use top-right when captions sit at the bottom; side-by-side: the speaker in one column and the panel in the other (anchor left/right, ratio = the speaker column's share of the width, default 0.5; best in 1:1 and 16:9 frames); full: back to the speaker full frame (clears that range). For splits, ratio = the speaker's share of the height (0.5 default, 0.6 keeps the face bigger). Visuals you add inside a layout range land in the free area by themselves.
- Use a split while the speaker explains something with steps, a comparison or numbers (3-15 s): the diagram, chart, icons or animation go in the panel. Use a short visual-only (2-4 s) for one striking number or image. Keep at least half of the clip full frame: the face is what holds attention.
- Add the layout FIRST, then the visuals for that range: visuals without an explicit region or at land in the panel on their own.
- The layout wraps the clip video in "Speaker" (a group, or a masked rect once pip/side-by-side is used) and adds a rect "Layout panel" (plus "Layout backdrop" for pip): do not edit or delete them by hand; call set_layout again. It survives text cuts and set_frame.
- check reports covers-speaker when a visual sits on the speaker's band.
- Several sources at once (B-roll, photos, the clip's own video) go in apply_layout, not set_layout: layouts full, side_by_side, top_bottom, pip_top_left/top_right/bottom_left/bottom_right (main = the full frame, inset = the small corner box on top), grid_2x2/3x3/4x4, main_sidebar (70/30), three_up (3 columns), three_stack (3 rows). Every slot needs an element (list_library + place_broll first for new media); the elements must play at the same time. fit fill crops to cover the slot (anchor picks the kept part, e.g. top for a face), fit shows all of it. The clip's own video can take one slot: it keeps its face tracking and the slot holds while the other elements play. On a vertical clip prefer three_stack, top_bottom or a pip; three_up columns are thin.`,

  visuals: `# Explainer visuals

Use a visual when the speaker explains something a picture makes faster: steps, a loop, a comparison, a number, a trend, a formula. One visual at a time; 2-6 seconds each; never more than one idea on screen.

- Icons: find_icons {query} then add_icon {name, at, size, motion}. Match the word being said (money → dollar-sign or wallet, growth → trending-up, time → clock, idea → lightbulb). Motion adds life: spin for loops/refresh, bounce for a person, pulse for a heart or a target, fly for anything travelling (an arrow from a bow-arrow to a target, with orient true). Keep 1-3 icons on screen at once.
- Point at things: add_shape arrow/circle/underline/highlight/check/cross. They draw on like a hand sketch. Coordinates are 0-1 of the frame.
- Steps or a process: add_diagram layout "column" on vertical video (3-5 short labels, 1-4 words each), "row" for 2-3 steps, "cycle" for a loop, "tree" for one idea splitting into parts, "compare" for A vs B with 2-3 bullet items each.
- Numbers: add_chart "stat" for one big number (value + short label), "bar" to compare 2-6 values, "line" for growth over time, "donut"/"pie" for shares of a whole.
- Formulas and curves: add_graph (y = f(x)), e.g. "2^x" for compounding, "x^2" for acceleration.
- Timing: pass quote with the words from <clip_context>; the visual starts on the first word and lasts to the end of that line (2-6 s). Give start/end (clip seconds) only to stretch it to the end of the idea. Diagrams build node by node; their total build takes about 60% of their time on screen.
- Placement: the default region is the top third of a vertical frame, clear of the face and the captions. If the face is high in the frame, move the region lower (region {x, y, width, height} in 0-1) or move captions. Capture a frame in the middle of the visual and at its end: labels readable, nothing covering the face.
- Change a visual later with update_visual {id, changes} (labels, data, layout, colors, region); do not delete and re-add.
- stagger animates a list of elements one after another.
- Custom shapes: insert_node a path (SVG d) with strokes, and keyframe trimEnd 0 → 1 to draw it on; keyframe "d" between two paths to morph one shape into another.`,

  brand: `# Brand kit

When <clip_context> has "brand", the clip is on the user's brand kit:
- Drawn visuals (charts, diagrams, icons, shapes, graphs) take the brand colors and heading font automatically. Do not pass colors unless the user asks for a different one.
- Text you add (add_text, insert_node): use the brand heading_font for titles and the brand colors for highlights.
- Captions already use the brand style; do not change caption style unless asked.
- You cannot create or change brand kits. If the user wants their brand applied or edited, tell them: menu › Apply brand kit in the editor, or the Brand kit page in the app.`,

  explainer: `# Animated explainers and motion clips (/explain → preview_explainer → add_explainer)

An explainer is a 15-90 s narrated animation of ONE idea; a motion clip (silent: true) is 3-30 s with no voice. Both are Remotion scenes YOU write: your own art direction, your own drawings, your own motion. The viewer must understand it with the sound off: every beat SHOWS what its narration names, drawn in the scene code (SVG, CSS, type), not stock clip-art. The bar is a launch video by a top design team. It renders as one video layer; an explainer gets its own voice and captions (credits after the user approves).

## 1. Art direction first
Before the storyboard, decide the look of THIS video: palette (hex values), background, fonts, motion vocabulary.
- list_motion_styles → named directions with what each suits (kinetic type for hooks and claims, gradient flow for results and numbers, neon tech for how software works…). get_motion_style { id } → its guide (palette, background, fonts, motion numbers, composition, do and don't) and an example shot's code: read the code, it shows the techniques.
- Or derive your own from the user's brand (apply_brand_kit colours, their site) the same way: 1 field colour, 1 ink, 1 accent (2 at most), a display font and a text font from kit.fonts, a motion character.
- One direction for the whole video. Tell the user which one and why in one line with the storyboard.
- theme and personality on the tools only seed kit.color and the library pieces; your scene paints its own background and picks its own colours. Send theme "blueprint" for a dark direction, "paper" for a light one.

## 2. Storyboard — subject first, then show it and ask
For EVERY beat:
1. say (6-20 words of narration, about 4 s) and label (the main words on screen, at most 5).
2. The subject: what is DRAWN (the sea is a band under a curve, a ship a hull path, a mast line and a sail; a claim is set as big type; a number rolls up), and how it moves or changes.
3. visual: one line, e.g. "a flat disc tilts 30° to show its edge; a dashed horizon draws across it; a ship sinks hull-first".
Show the storyboard (say, label, visual per beat) and the direction in one line, and ask "Shall I make it?". Wait for the go unless the user already said to go ahead.
- One structure: problem → mechanism → result; question → steps → answer; myth → why it fails → what works; before → change → after.
- Beat 1 is the hook: a surprising question or fact, never "In this video…". 4-12 beats.
- Each beat transforms the picture; no slideshow of separate pictures, no rows of cards, no title-plus-bullets screens.
- Only facts you are sure of, or the user's words. Nothing about real people or other brands.
Silent motion clips: every beat gives its seconds (0.5-30, at most 8 beats, 30 s in all); say is the storyboard line, never read aloud. For an intro, a logo reveal, a product moment. list_motion_templates has finished ones (brand reveal, phone carousel, analytics card): get_motion_template, change only its SLOTS, keep its motion.

After the go, before code, write the direction (the tools' direction field, 120-3000 characters): the spec you code from, with numbers. Per shot: the one visual centre, then every move — what, from → to in px or % of the frame, start and end in seconds, the curve (kit.curves name). What stays alive between moves (a slow push, a drifting field, a breathing glow). End with the bar: "match every number, then make it as beautiful as possible: easing, motion blur, typography, depth, composition; resting text crisp; nothing clipped or overlapping by accident."

## 3. The code
The BODY of (React, R, kit) => { …; return function Scene() { … } } with JSX. No imports. Compute constants, geometry and helpers once above return function Scene(); inside, read the frame and compose JSX.
- R is a safe part of Remotion: AbsoluteFill, Series, Freeze, Loop, useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring, measureSpring, Easing, random.
- Rejected with the line number: fetch, XMLHttpRequest, WebSocket, import, require, eval, Function, Date, Math.random, timers, document, window, storage, constructor, Remotion media and render control. Randomness: kit.random(seed), kit.noise(seed); time comes from the frame.
- Pixels of the composition (1920×1080, 1080×1920 or 1080×1080; kit.width, kit.height), frames at 30 fps (kit.fps, kit.frames). Keep text inside kit.area('full'): the bottom 17% is the captions' place.
Write it shot by shot (small pieces are what make motion good)
- One function component per beat (or per two short beats), composed with <Shot beat={i} through? pre? post?>: its children render only during that beat (pre/post frames overlap a neighbour for a transition), and kit.useShot() inside gives { frame, frames, progress } counted from the shot's start. Things that live across beats (a background, a subject that transforms) sit outside the shots.
- Timing: kit.beat(i) → { from, to, frames }; kit.cue(i, 'word') → the frame that word is spoken; kit.at(i, 0..1). Previews use estimated timings and the render the real voice, so anything placed with these lands on the narration in both. Never hard-code frames of a narrated explainer.
The core — what scenes are built from
- <Mark name x y w h at? exitAt?>…</Mark> wraps every drawing (svg, path, a div with transforms and filters): a box, top-left x, y and size in px, sized to the drawing's resting box. The layout report and the jump check only see tagged boxes; a drawing outside a Mark reads as an empty frame. Unique names ("sea", "ship"). No entrance of its own: your code moves what is inside.
- <Text text x y size w? font? weight? color? align? tracking? lineHeight? upper? italic? name? at? exitAt? style?> — free typography the report still checks (size ≥ 36 px at 1080, overlap, safe area). x is the left edge, centre or right edge by align; y the top. font: a role (display, text, title, mono) or any family in kit.fonts — Inter, Plus Jakarta Sans, Space Grotesk, Unbounded, Sora, Archivo Black, Anton, Bebas Neue, Oswald, DM Serif Display, Playfair Display, Fraunces, Source Code Pro… (kit.fonts maps each to its weight range). color: any #hex, rgb() or hsl(). Animate it through style (transform, opacity, clipPath) or one Text per word (unique names). kit.measure(text, { size, font, weight, tracking }) → its width in px.
- Backgrounds and finish (kit.fx): <fx.Fill color to? angle?>, <fx.GradientField colors={[base, …3 blobs]} speed? softness? seed?> (a flowing mesh), <fx.Vignette strength? color?>, <fx.Grain opacity?>, <fx.LightSweep at dur? angle? width? color?>. Paint the field first, grain last.
- Curves: kit.curves — linear, smooth (moves), out (entrances), soft, in (exits), snap (decisive edits), back (about 3% overshoot), anticipate (a 5% wind-up). kit.tween(frame, [f0, f1], [a, b], curve) eases a number or a point and holds before and after.
- Motion that reads as premium:
  - kit.travel(u, distance, { overshoot: 24 }) → px offset of an entrance that overshoots by at most 24 px and settles with zero speed (u is 0..1 progress).
  - kit.snap(u, { overshoot: 0.02 }) → a two-phase snap progress for a hand-over.
  - <Streak speed size axis? origin?> — directional motion blur and a stretch tied to speed (px per frame: the offset now minus the offset a frame ago); nothing at rest, so resting text is crisp.
  - kit.speedBlur(speed) → px of plain blur; kit.drawOn(p) → stroke props that draw a path on; kit.morph(a, b, t) between point lists; kit.noise(seed)(t) for organic drift; kit.stagger(i, { at, each }).
  - Something is always alive: a slow push (scale 1 → 1.04 over the video), a drifting field, a breathing glow (±15%).
- Compute geometry once: paths as small functions of one or two numbers; per frame only interpolate those numbers. The code limit is 32,000 characters.
The library — only when it is the clearest picture
- <Image name x y w h fit? radius?> (the user's own images passed as assets), <Phone>/<Browser> frames around them, for product moments.
- <Icon name x y size color?> (Lucide, find_icons) for a small standard symbol: a check, a clock, a lock. Never as the subject of a beat.
- <Shape>, <Path>, <Arrow>, <Group>, <Burst>, <Camera>, <Stage>, <Headline>, <Board>, <Title>, <Label>, <Counter>, data marks (<Axes>, <Scatter>, <FitLine>, <Waveform>…) and kit.color still work; reach for them only when your own drawing would not be better.

${EXPLAINER_MOTION}

Example (a narrated explainer, shot by shot, every subject drawn, its own palette; visuals: ${EXPLAINER_EXAMPLE_BEATS.map((beat, i) => `${i + 1}) ${beat.visual}`).join("; ")}):
${EXPLAINER_EXAMPLE}

## 4. Preview, look, fix — required
preview_explainer { title, beats (with visual), direction, code, format, theme, personality, times } returns stills and a layout report.
- times: up to 12 seconds you choose, around every main move (its start, middle and landing). Without times: beat midpoints and the last frame.
- Subject check: one line per still — "shows X; the beat says Y". Fix any beat where they differ first.
- An error (phase job/compile/guard/render + message) → fix the code.
- "overlaps" → move one text to another place or time. "outside the safe area" → keep resting text inside kit.area('full') (moving text may cross it). "text under 36 px" → fewer words, bigger type.
- "more than 85% empty" or "beat N shows nothing drawn" → draw the subject bigger, in a Mark, or set the claim as big type.
- "nothing moves during beat N" → a move, a reaction, or something alive (push, drift, glow).
- "jumps N px in one frame" → ease the move (kit.travel, a curve) and give it a Streak, or make it a deliberate cut.
- Then answer the review checklist that comes back with the stills, line by line, against your direction. Name the one worst problem, fix only that, preview again.
Up to 6 rounds; stop when a round finds nothing. A clean layout report is the floor, not the bar.

## 5. Add it
add_explainer { title, beats (with visual), direction, code (exactly what you last previewed), format, theme, personality, voice }. format = clip_context.frame on a clip; on a blank New edit 9:16 unless the user asked for another shape. The duration comes from the narration (from the beats' seconds for a silent clip). The card shows each beat, the voice and the price; after approval the layer "Explainer: <title>" renders in a few minutes, and a captions layer follows when the voice has word timings. Call wait_for_media, then capture a frame in its middle to confirm it plays.`,

  voiceover: `# Voiceover (add_voiceover, when available)

A new AI voice on the clip. It costs credits (the user approves the price) and arrives in a few seconds to a minute. Only when the user asks for a voiceover, narration, a new script or to "repurpose" the clip.

- mode "replace" (repurpose the whole clip): the new voice replaces the speaker. The original speech is muted and its captions hidden; new captions follow the new voice word by word. Workflow:
  1. get_transcript and read <clip_context>: what is the clip actually about?
  2. Write a NEW script in your own words from the angle the user wants (commentary, summary, a lesson, a reaction). Do not copy the speaker's sentences. Fit the clip: about 3 words per second of clip (a 30 s clip ≈ 85-90 words). Short sentences read better.
  3. add_voiceover mode "replace" with the script and a voice.
  4. Add visuals that follow the NEW script (add_chart, add_diagram, a motion clip with add_explainer, library media, generate_media when the user wants AI B-roll). The new captions have the new words; plan beats with update_plan by script position.
- mode "overlay" (a short line over the clip): start (clip seconds) or quote (it starts after those words); the original audio drops by duck_db (default -18 dB) while it speaks. Captions off by default.
- Voices: pick one that fits the tone; say which one you picked.
- The voice appears as a layer named "Voiceover: …"; deleting it restores the original audio and captions.
- Do not claim that a new voice or new visuals make it fine to use someone else's video. If the user asks about rights, say that permission from the owner is still needed.`,

  blank: `# Project without a script (blank "New edit", AI-only video)

Nothing is spoken, so there are no quotes to anchor to: every piece of media is placed by time.

When the user describes a whole video ("a 20-second video about…", /video), call create_video (read_guide "video"): keyframes first, then the shots between them, each with its own card. The steps below are for building it piece by piece, when the user asks for single shots or wants to pick stills first.

1. Plan the video first with update_plan, one beat per line in seconds: "[0-3s] hook: a laptop glowing in a dark hotel room", "[3-7s] the dashboard fills with bookings". Keep each shot 2-5 seconds.
2. work_area in <clip_context> is how long the video plays. When the plan is longer, set_workarea {start: 0, end: <plan length>} BEFORE adding media, or the shots past the end will not play.
3. Stills first: generate_media kind "image" for every shot in ONE message (one card, one total price), each with idea, subject, action, setting, style, camera, mood, start = the beat's first second and length = the beat's seconds, and variants 3 so the user can keep the best version of each shot. No quote. One style and the frame's aspect ratio for every shot.
4. After approval, wait_for_media, then capture a frame on each, tell the user they can pick another variant in the Inspector (Variants), then ask_user which shots to animate (animation costs much more). Animate with generate_media kind "video": start_image = that still, the same brief, the same start, length = the beat, muted true. Delete the still each video replaces.
5. Words: add_voiceover with mode "overlay" and start 0 (about 3 words per second of video), or add_text titles timed to the beats.
6. Music: generate_media kind "audio" (instrumental, mood, genre, tempo), start 0, duration = the video length up to the model's limit, then set_props volume -18 when there is a voice.
7. Capture a frame in the middle of every beat: nothing empty, nothing off-screen, text readable.`,

  intro: `# Intro (plan_video)

The Video agent team builds intros: do not assemble them with add_text and keyframes.

1. read_skill "motion-profile" when <your_skills> lists it: it holds the personality and colours the user liked last time. Add it to the brief.
2. plan_video {recipe: "intro", brief: the user's words}. Pass title only when the user gave the exact words, seconds only when they asked for a length.
3. The user approves a storyboard (beats with times). If they cancel, ask what to change and call plan_video again with a better brief.
4. After it is applied, capture at the end of each beat and at the last second: the title is readable, nothing is cut off, the clip shows through after the intro.
5. When the user is happy, save_skill "motion-profile" with one line: the personality, the mood and anything they asked for ("premium, calm, brand blue, no tagline").`,

  video: `# A whole AI video (create_video → animate_video, /video)

A /video is made in two approvals, so the user sees every picture before the expensive part:
- Card 1 (create_video): a director writes the voice-over, splits it into beats and gives each a keyframe (its first frame) and a motion. The card shows the storyboard, the keyframe price and about what the video will cost after. Approving makes only the keyframes (stills), into the library under Generated/<title>/keyframes.
- Card 2 (animate_video): the keyframes in order with their words, a Redo on each, and the exact video price. Approving makes every shot at once (each moves from its keyframe to the next), the voice-over, captions and a music bed, placed as one block on the timeline.

1. Use it on a blank "New edit" only. On a clip of the user's own footage, add AI shots with B-roll (read_guide "broll") or generate_media instead: create_video would reframe and cover their video, and it refuses to run there.
2. Pass the user's words as prompt. Pass seconds, aspect, voice or model only when the user asked for them. Shots come out at the model's shot lengths, so the video can end up a second shorter or longer than asked; say so if it matters.
3. If card 1 is cancelled, ask what to change (story, length, tone) and call create_video again. Nothing was charged.
4. After card 1 is approved, call wait_for_media (again if some are still generating), then animate_video with the plan, aspect, model and keyframes from create_video's result (and its voice, when it returned one). Never call animate_video before the keyframes are done: it refuses a missing keyframe.
5. A keyframe the user does not like: Redo it on card 2 (1 credit, new picture) instead of making the whole video again. Once the video is placed, redo_keyframe makes a new keyframe and remakes only the at most 2 shots that start or end on it; the old files stay in the library.
6. Continue or cut: a beat that continues flows into the next keyframe with no cut (same place, or a camera move that gets there); a cut starts the next beat on a fresh keyframe. Cut where the story changes place or idea; continue inside one place. When no model can end on a frame for this aspect, card 1 says every beat is a separate shot.
7. After card 2 is approved the shots fill in as they finish. Call wait_for_media, then capture a frame in the middle of a few shots and at a few seams: each fills the frame, the shots join without a jump, the on-screen text is readable, the captions follow the voice.`,

  edit: `# Edit your own video with words (edit_video, /edit)

edit_video redraws one range of the user's own video from a short instruction: light, setting, style, weather ("make it night", "a cosy studio behind me", "film look"). The speaker's motion and the camera stay; the original sound keeps playing.

1. Pick a range of 3-10 s inside one shot (no cut, no split-screen layout on it). For a longer change, ask which moment matters most; each range is its own paid edit.
2. Write the change, not the whole scene: "night, warm desk lamp, city lights in the window". No real people, celebrities or logos: those are refused.
3. To change only what is behind the speaker, use replace_background instead: it keeps the speaker exactly as filmed.
4. The user approves the price. After it is placed, wait_for_media, then capture a frame in the middle of the range: the speaker is in the same place and the edit covers the whole range.`,

  proof: `# Proof B-roll (capture_page → add_proof)

A claim lands harder when the viewer sees it: the repo with "24 lifecycle skills", the pricing page that says "free", the speaker's title on a team page. Only a public page the speaker cites earns a proof; an opinion or a story does not.

1. Capture first: capture_page with the page's address (a GitHub repo, a README, a docs or pricing page). Free, 30 a day; the same page within 24 h comes from the cache. Local and private addresses are refused.
2. Wait: capture_status until it says ready (a few seconds). If it failed, say why in one line and go on without that proof; never invent one.
3. Pick focus from text that is actually on the page, a few words copied exactly: the number with its noun ("24 lifecycle skills"), the price, the title. If add_proof says the words are not on the page, use the closest text it names, or skip the proof.
4. Pick quote from the transcript: the words where the speaker says the claim. The card comes up just before them, zooms to the focus and marks it as they start.
5. One proof per claim, at most 6 in a clip, never two at once. In a split layout the card goes in the visual panel; full frame, the upper part, clear of the face and the captions.
6. Capture a frame at the mark and look: the marked words are readable and inside the frame.

The page is shown as captured, with its real address: never edit, fake or generate a page.`,

  document: "",
} as const;

export type GuideName = keyof typeof GUIDES;
export const GUIDE_NAMES = Object.keys(GUIDES) as [GuideName, ...GuideName[]];

let documentText: string | null = null;

export function readGuide(name: GuideName): string {
  if (name === "document") return (documentText ??= documentGuide());
  return GUIDES[name];
}
