import { continueRender, delayRender, staticFile } from 'remotion';

/** Bundled from packages/clip-media/fonts (the bundle's public dir). */
export const FONTS = {
	title: { family: 'OpenCMO Motion Title', file: 'fraunces.woff2' },
	text: { family: 'OpenCMO Motion Text', file: 'inter.woff2' },
	mono: { family: 'OpenCMO Motion Mono', file: 'source-code-pro.woff2' },
	// Display face for brand moments and product titles (OFL, packages/clip-media/fonts/LICENSE-OFL.txt).
	display: { family: 'OpenCMO Motion Display', file: 'plus-jakarta-sans.woff2' },
} as const;

export const FAMILY = {
	title: `'${FONTS.title.family}', Georgia, serif`,
	text: `'${FONTS.text.family}', system-ui, sans-serif`,
	mono: `'${FONTS.mono.family}', ui-monospace, monospace`,
	display: `'${FONTS.display.family}', system-ui, sans-serif`,
};

let loading: Promise<void> | null = null;

/** Every frame waits for the fonts, so text never renders in a fallback face. */
export function loadFonts(): Promise<void> {
	if (loading) return loading;
	const handle = delayRender('Loading fonts');
	loading = Promise.all(
		Object.values(FONTS).map(async ({ family, file }) => {
			const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`);
			document.fonts.add(await face.load());
		}),
	).then(() => continueRender(handle));
	return loading;
}
