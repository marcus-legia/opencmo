/** Node side: the names of the built-in Lottie animations, as the kit addresses them (`walk`, `emoji/brain`). */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { lottieDir } from './assets.ts';

export function lottieNames(dir = lottieDir()): string[] {
	const names = (folder: string, prefix: string) =>
		readdirSync(join(dir, folder))
			.filter((name) => name.endsWith('.json'))
			.map((name) => `${prefix}${name.slice(0, -'.json'.length)}`)
			.sort();
	return [...names('.', ''), ...names('emoji', 'emoji/')];
}
