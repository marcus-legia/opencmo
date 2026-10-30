/**
 * Edits with no upload behind them: a blank New edit and a New slideshow. The client twin of `startsEmpty` in
 * `lib/editor/project.ts` (server code, not importable here); the two must agree.
 */
export const startsEmpty = (kind: string | null | undefined): boolean => kind === "blank" || kind === "slideshow";
