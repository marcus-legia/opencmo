/** The scene code failed (compile, guard or runtime): the agent's fault, never retried (exit 4). */
export class MotionCodeFailure extends Error {
	readonly phase: 'compile' | 'guard' | 'render';

	constructor(message: string, phase: 'compile' | 'guard' | 'render') {
		super(message);
		this.name = 'MotionCodeFailure';
		this.phase = phase;
	}
}

/** Prefix of errors thrown by the scene inside the page; render.ts maps them back to exit 4. */
export const SCENE_ERROR_MARKER = '[scene-code]';
