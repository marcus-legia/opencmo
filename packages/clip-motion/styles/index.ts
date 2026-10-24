/**
 * Motion styles: named art directions a scene starts from (palette, background, type, motion vocabulary with numbers,
 * do and don't), each with an example shot that previews clean. A model picks one (or derives its own from the
 * user's brand), reads `guide` and `code`, then writes its own scene in that direction. The source of each is
 * `styles/<id>/{style.json,STYLE.md,example.jsx}`; `index.gen.ts` is generated from them.
 */

import { STYLE_DATA } from './index.gen';

export type MotionStyle = {
	id: string;
	title: string;
	/** One line: what it looks like. */
	line: string;
	/** Topics and moments it suits. */
	bestFor: string[];
	format: '16:9' | '9:16' | '1:1';
	seconds: number;
	/** The example's beats (silent clip, with seconds). */
	beats: { say: string; visual: string; seconds: number }[];
	/** STYLE.md: palette, background, type, motion, composition, do and don't. */
	guide: string;
	/** The example shot's scene body for (React, R, kit). */
	code: string;
	source?: { repo: string; path: string; license: 'MIT' };
};

export const MOTION_STYLES: readonly MotionStyle[] = STYLE_DATA as readonly MotionStyle[];

export const motionStyle = (id: string): MotionStyle | undefined => MOTION_STYLES.find((style) => style.id === id);
