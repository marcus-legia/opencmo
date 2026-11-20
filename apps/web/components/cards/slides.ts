/** The Slides view of an edit (the editor's own; slideshow cards are gone since wave 4b). */
export const slidesHref = (clipId: string): string => `/app/editor/${encodeURIComponent(clipId)}?view=slides`;
