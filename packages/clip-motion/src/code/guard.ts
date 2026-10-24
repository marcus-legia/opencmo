/**
 * Scene code is the BODY of `(React, R, kit) => { …; return function Scene() { … } }`, written by the
 * Assistant. This is not the security boundary (the render runs in a
 * container without network or secrets, and Chromium is launched offline); it keeps renders
 * deterministic and gives the agent a precise message to fix.
 */

/** Name of the wrapper compile.ts puts around the body; run.ts calls it in the page. */
export const SCENE_FUNCTION = '__scene';

/** Globals the code may not touch. Shadowed with `undefined` at run time as well. */
export const SHADOWED = [
	'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker',
	'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
	'Date', 'performance', 'crypto', 'Function',
	'globalThis', 'self', 'window', 'document', 'navigator', 'location',
	'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'postMessage', 'require', 'process',
] as const;

const FORBIDDEN: { pattern: RegExp; message: string }[] = [
	{ pattern: /(?<![\w$.])import\s*[({.]|^\s*import\s/m, message: '`import` is not allowed: everything you need is in React, R and kit.' },
	{ pattern: /(?<![\w$.])eval\s*\(/, message: '`eval` is not allowed.' },
	{ pattern: /\bMath\s*\.\s*random\b/, message: '`Math.random` is not allowed: use `kit.random(seed)`, which is seeded.' },
	{ pattern: /\bconstructor\b/, message: '`constructor` is not allowed.' },
	{ pattern: /\bR\s*\.\s*(delayRender|continueRender|staticFile|Img|Audio|Video|OffthreadVideo|IFrame)\b/, message: 'Media and render-control parts of Remotion are not available to scenes.' },
	...SHADOWED.map((name) => ({
		pattern: new RegExp(`(?<![\\w$.])${name}(?![\\w$])`),
		message: `\`${name}\` is not allowed in a scene${name === 'Date' ? ': time comes from the frame (R.useCurrentFrame())' : ''}.`,
	})),
];

/** Strings and comments removed, newlines kept, so matches report the right line. */
function codeOnly(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (match) => match.replace(/[^\n]/g, ' '));
}

export type GuardIssue = { line: number; message: string };

export function guardScene(source: string): GuardIssue | null {
	const code = codeOnly(source);
	let first: GuardIssue | null = null;
	for (const { pattern, message } of FORBIDDEN) {
		const match = pattern.exec(code);
		if (!match) continue;
		const line = code.slice(0, match.index).split('\n').length;
		if (!first || line < first.line) first = { line, message };
	}
	return first;
}
