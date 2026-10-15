import { describe, expect, it } from 'vitest';

import { lottieNames } from '../lottie-files.ts';
import { LOTTIE_NAMES } from './lotties.ts';

describe('built-in Lottie names', () => {
	it('match packages/clip-media/lottie (run node scripts/build-lotties.ts after changing the pack)', () => {
		expect([...LOTTIE_NAMES]).toEqual(lottieNames());
	});

	it('include the pack and the animated emoji', () => {
		expect(LOTTIE_NAMES).toContain('heart-beat');
		expect(LOTTIE_NAMES).toContain('emoji/brain');
	});
});
