/**
 * Style skills in the editor Assistant (docs/style-skills-build.md, Track A).
 *
 * A style is data from `@opencmo/skills`: a preset the machine applies and a body of judgment the
 * model applies. The Assistant sees only the styles whose capabilities are all ready, so a style
 * goes live the moment its last capability is flipped, and never before ("don't ship coming soon").
 */

import { missingCapabilities } from "@opencmo/editor-core/capabilities";
import { STYLES, styleByName, type Skill } from "@opencmo/skills";

/** Styles every capability of which works today. */
export function readyStyles(): Skill[] {
  return STYLES.filter((style) => !missingCapabilities(style.requires).length);
}

export function readyStyle(name: string): Skill | null {
  const style = styleByName(name);
  return style && !missingCapabilities(style.requires).length ? style : null;
}

/** The steps the model follows with a style; the `/style` directive and `read_skill` say the same. */
export const STYLE_STEPS =
  "Follow the style: if a claim earns a proof, capture its page first (capture_page) and wait until capture_status says ready; then write ONE Edit Plan with quotes copied exactly from <clip_context> and call apply_style once; then run check, capture a frame at the hook and at each proof and look at them; finally tell the user what was applied and everything in the receipt's skipped and unavailable lists.";

/** The `<styles>` block of the clip context: name and one line each. Empty when no style is ready. */
export function styleIndex(): string {
  const rows = readyStyles().map(({ name, description }) => ({ name, description }));
  return rows.length ? `<styles>${JSON.stringify(rows)}</styles>` : "";
}

/** `read_skill` content for a ready style; null for any other name (user skills are looked up next). */
export function readStyleSkill(name: string): string | null {
  const style = readyStyle(name);
  if (!style) return null;
  return JSON.stringify({ style: { name: style.name, description: style.description, preset: style.preset ?? {}, guide: style.body }, steps: STYLE_STEPS });
}
