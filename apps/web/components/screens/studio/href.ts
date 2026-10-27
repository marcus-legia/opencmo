import { UI_V2 } from "../flag";

/**
 * Where "the founder's uploads" live. With the redesign on, Studio replaces My projects (U7b); the old
 * routes redirect there. One helper so the editor, the shell and Studio agree.
 */
export function studioHref(): string {
  return UI_V2 ? "/app/studio" : "/app/projects";
}

/** One upload: Studio's item drawer, or the old project page with the flag off. */
export function studioItemHref(projectId: string): string {
  const id = encodeURIComponent(projectId);
  return UI_V2 ? `/app/studio?item=${id}` : `/app/projects/${id}`;
}
