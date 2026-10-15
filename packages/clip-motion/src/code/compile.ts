/**
 * Node side: TSX scene body → plain JS run inside the Chromium page (`run.ts`). Errors are
 * `MotionCodeFailure` with a phase and a line number, so the agent can fix the right place.
 */

import { transformSync, type TransformFailure } from 'esbuild';

import { MAX_CODE_CHARS } from '../job.ts';
import { MotionCodeFailure } from '../errors.ts';
import { guardScene, SCENE_FUNCTION } from './guard.ts';

const HEADER = `function ${SCENE_FUNCTION}(React, R, kit) {\n`;

export function compileScene(code: string): string {
	if (!code.trim()) throw new MotionCodeFailure('The scene code is empty.', 'compile');
	if (code.length > MAX_CODE_CHARS) throw new MotionCodeFailure(`The scene code is longer than ${MAX_CODE_CHARS} characters.`, 'compile');
	let js: string;
	try {
		js = transformSync(`${HEADER}${code}\n}`, {
			loader: 'tsx',
			jsx: 'transform',
			jsxFactory: 'React.createElement',
			jsxFragment: 'React.Fragment',
			target: 'es2022',
			logLevel: 'silent',
		}).code;
	} catch (error) {
		const first = (error as TransformFailure).errors?.[0];
		if (!first) throw new MotionCodeFailure(`Syntax error: ${(error as Error).message}`, 'compile');
		const where = first.location ? `Line ${Math.max(1, first.location.line - 1)}:${first.location.column + 1}: ` : '';
		throw new MotionCodeFailure(`Syntax error. ${where}${first.text}`, 'compile');
	}
	const issue = guardScene(code);
	if (issue) throw new MotionCodeFailure(`Line ${issue.line}: ${issue.message}`, 'guard');
	return js;
}
