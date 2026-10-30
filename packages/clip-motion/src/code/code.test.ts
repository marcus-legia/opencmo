import { describe, expect, it } from 'vitest';

import { MotionCodeFailure } from '../errors.ts';
import { compileScene } from './compile.ts';
import { guardScene } from './guard.ts';

function failure(code: string): MotionCodeFailure {
	try {
		compileScene(code);
	} catch (error) {
		if (error instanceof MotionCodeFailure) return error;
		throw error;
	}
	throw new Error('expected a failure');
}

describe('compileScene', () => {
	it('turns JSX into React.createElement inside the scene wrapper', () => {
		const js = compileScene('const { Stage } = kit;\nreturn function Scene() { return <Stage><div /></Stage>; };');
		expect(js).toContain('React.createElement(Stage');
		expect(js).toContain('function __scene(React, R, kit)');
	});

	it('accepts TypeScript annotations', () => {
		expect(() => compileScene('const n: number = 2;\nreturn function Scene(): null { return null; };')).not.toThrow();
	});

	it('reports syntax errors with the line of the agent code', () => {
		const error = failure('const a = 1;\nconst b = ;\nreturn function Scene() { return null; };');
		expect(error.phase).toBe('compile');
		expect(error.message).toMatch(/^Syntax error\. Line 2:\d+/);
	});

	it.each([
		['fetch("https://x")', 'fetch'],
		['new XMLHttpRequest()', 'XMLHttpRequest'],
		['new WebSocket("ws://x")', 'WebSocket'],
		['import("x")', 'import'],
		['require("fs")', 'require'],
		['eval("1")', 'eval'],
		['new Function("return 1")', 'Function'],
		['Date.now()', 'Date'],
		['Math.random()', 'Math.random'],
		['ref.current.getContext("webgl2")', 'Canvas contexts'],
		['setTimeout(() => 0, 1)', 'setTimeout'],
		['document.body', 'document'],
		['window.innerWidth', 'window'],
		['localStorage.getItem("a")', 'localStorage'],
		['({}).constructor.constructor("return this")()', 'constructor'],
		['R.staticFile("a.png")', 'Remotion'],
	])('rejects %s', (expression, word) => {
		const error = failure(`const x = 1;\nconst y = ${expression};\nreturn function Scene() { return null; };`);
		expect(error.phase).toBe('guard');
		expect(error.message).toMatch(/^Line 2: /);
		expect(error.message).toContain(word);
	});

	it('ignores forbidden words inside strings, comments and property names', () => {
		expect(guardScene('// fetch the data\nconst label = "Date of birth";\nconst t = kit.random(1);\nconst o = { a: kit.color.signal }; o.fetch;\nreturn () => null;')).toBeNull();
	});

	it('rejects empty and oversized code', () => {
		expect(failure('   ').message).toContain('empty');
		expect(failure(`// ${'x'.repeat(32_001)}`).message).toContain('32000');
	});
});
