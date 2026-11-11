/**
 * How long a slide's words may be, so they fit the frame. Its own module (`@opencmo/editor-core/slide-limits`): the
 * approval cards check slide text in the browser, and importing the package root for one constant pulled every
 * operation into the feed's bundle (80 kB gzipped).
 */
export const SLIDE_TEXT_MAX = { heading: 60, body: 130 } as const;
