import { defineConfig } from 'vitest/config';

import { isTargetClosed } from './src/render.ts';

export default defineConfig({
	test: {
		// A preview whose scene throws closes a browser with a dead page: Remotion's "Target closed" rejection is
		// expected there (see isTargetClosed); every other unhandled error still fails the run.
		onUnhandledError: (error) => !isTargetClosed(error),
	},
});
