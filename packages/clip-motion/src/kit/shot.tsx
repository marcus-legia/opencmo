import React, { createContext, useContext } from 'react';
import { useCurrentFrame } from 'remotion';

import { kitError } from './context.tsx';

export type ShotSpan = { from: number; to: number; frames: number };
export type ShotState = ShotSpan & { index: number; frame: number; progress: number };

export const ShotContext = createContext<(ShotSpan & { index: number }) | null>(null);

export type ShotProps = {
	/** The beat this shot plays (kit.beat(i)); `through` extends it to a later beat. */
	beat: number;
	through?: number;
	/** Frames before the beat starts (to overlap the previous shot in a transition) and after it ends. */
	pre?: number;
	post?: number;
	children?: React.ReactNode;
};

/**
 * `kit.Shot`: one beat as its own small piece of the scene. Its children render only inside the beat (plus `pre` and
 * `post`), and `kit.useShot()` gives them a frame counted from the beat's start, so each shot is written as a short,
 * self-contained animation. Global frames (kit.at, kit.cue) still work inside: the frame is not shifted.
 */
export function makeShot(beatAt: (i: number) => ShotSpan, beats: number) {
	return function Shot({ beat, through, pre = 0, post = 0, children }: ShotProps) {
		if (!Number.isInteger(beat) || beat < 0 || beat >= beats) throw kitError(`Shot beat must be 0 to ${beats - 1} (got ${String(beat)}).`);
		if (through !== undefined && (!Number.isInteger(through) || through < beat || through >= beats)) throw kitError(`Shot through must be a beat from ${beat} to ${beats - 1}.`);
		const frame = useCurrentFrame();
		const first = beatAt(beat);
		const last = beatAt(through ?? beat);
		const span = { from: first.from, to: last.to, frames: last.to - first.from };
		if (frame < span.from - pre || frame >= span.to + post) return null;
		return <ShotContext.Provider value={{ ...span, index: beat }}>{children}</ShotContext.Provider>;
	};
}

/** Inside a Shot: `frame` from the shot's start (negative during `pre`), `frames` long, `progress` 0..1. */
export function useShot(): ShotState {
	const span = useContext(ShotContext);
	const frame = useCurrentFrame();
	if (!span) throw kitError('useShot() is only for components rendered inside a <Shot>.');
	const local = frame - span.from;
	return { ...span, frame: local, progress: span.frames > 0 ? Math.min(1, Math.max(0, local / span.frames)) : 1 };
}
