/** Browser side: build the Scene component from compiled code (see compile.ts). */

import type React from 'react';

import { SCENE_ERROR_MARKER } from '../errors.ts';
import { SCENE_FUNCTION, SHADOWED } from './guard.ts';

const SEEDED_MATH: Math = Object.freeze(
	Object.assign(Object.create(Math) as Math, {
		random: () => {
			throw new Error('Math.random is not allowed: use kit.random(seed).');
		},
	}),
);

export function sceneError(message: string): Error {
	return new Error(`${SCENE_ERROR_MARKER} ${message}`);
}

export function buildScene(compiled: string, react: unknown, remotion: unknown, kit: unknown): React.ComponentType {
	let scene: unknown;
	try {
		// The scene code IS the program; this is the one place it is evaluated.
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const factory = new Function('React', 'R', 'kit', 'Math', ...SHADOWED, `"use strict";\n${compiled}\nreturn ${SCENE_FUNCTION}(React, R, kit);`);
		scene = factory(react, remotion, kit, SEEDED_MATH, ...SHADOWED.map(() => undefined));
	} catch (error) {
		throw sceneError(`The scene code threw while starting: ${(error as Error)?.message ?? String(error)}`);
	}
	if (typeof scene !== 'function') throw sceneError('The scene code must end with `return function Scene() { … }`.');
	return scene as React.ComponentType;
}
