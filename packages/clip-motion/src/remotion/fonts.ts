import { continueRender, delayRender, staticFile } from 'remotion';

/**
 * The editor's font library (packages/clip-media/fonts, OFL; the bundle's public dir), with each file's weight range
 * so a variable font renders every weight (a FontFace without a range is weight 400 only). Kept equal to
 * @opencmo/clip-render's FONTS by golden.test.ts.
 */
export const LIBRARY = {
	'Inter': { file: 'inter.woff2', weights: [100, 900] },
	'Montserrat': { file: 'montserrat.woff2', weights: [100, 900] },
	'Bangers': { file: 'bangers.woff2', weights: [400, 400] },
	'Chewy': { file: 'chewy.woff2', weights: [400, 400] },
	'Figtree': { file: 'figtree.woff2', weights: [300, 900] },
	'Geologica': { file: 'geologica.woff2', weights: [100, 900] },
	'Lora': { file: 'lora.woff2', weights: [400, 700] },
	'Nunito': { file: 'nunito.woff2', weights: [200, 1000] },
	'Source Code Pro': { file: 'source-code-pro.woff2', weights: [200, 900] },
	'Urbanist': { file: 'urbanist.woff2', weights: [100, 900] },
	'Anton': { file: 'anton.woff2', weights: [400, 400] },
	'Bebas Neue': { file: 'bebas-neue.woff2', weights: [400, 400] },
	'Archivo Black': { file: 'archivo-black.woff2', weights: [400, 400] },
	'DM Serif Display': { file: 'dm-serif-display.woff2', weights: [400, 400] },
	'Caveat Brush': { file: 'caveat-brush.woff2', weights: [400, 400] },
	'Pacifico': { file: 'pacifico.woff2', weights: [400, 400] },
	'Oswald': { file: 'oswald.woff2', weights: [200, 700] },
	'Raleway': { file: 'raleway.woff2', weights: [100, 900] },
	'Rubik': { file: 'rubik.woff2', weights: [300, 900] },
	'Work Sans': { file: 'work-sans.woff2', weights: [100, 900] },
	'Manrope': { file: 'manrope.woff2', weights: [200, 800] },
	'Plus Jakarta Sans': { file: 'plus-jakarta-sans.woff2', weights: [200, 800] },
	'Sora': { file: 'sora.woff2', weights: [100, 800] },
	'Outfit': { file: 'outfit.woff2', weights: [100, 900] },
	'Lexend': { file: 'lexend.woff2', weights: [100, 900] },
	'Space Grotesk': { file: 'space-grotesk.woff2', weights: [300, 700] },
	'DM Sans': { file: 'dm-sans.woff2', weights: [100, 1000] },
	'Playfair Display': { file: 'playfair-display.woff2', weights: [400, 900] },
	'Archivo': { file: 'archivo.woff2', weights: [100, 900] },
	'Unbounded': { file: 'unbounded.woff2', weights: [200, 900] },
	'Fraunces': { file: 'fraunces.woff2', weights: [100, 900] },
	'Caveat': { file: 'caveat.woff2', weights: [400, 700] },
} as const satisfies Record<string, { file: string; weights: readonly [number, number] }>;

export type LibraryFont = keyof typeof LIBRARY;

/** The four roles older scenes use (kit.font.title …), now names in the library. */
export const ROLES = { title: 'Fraunces', text: 'Inter', mono: 'Source Code Pro', display: 'Plus Jakarta Sans' } as const satisfies Record<string, LibraryFont>;

const FALLBACK: Record<string, string> = { title: 'Georgia, serif', mono: 'ui-monospace, monospace' };

/** CSS font-family for a role or a library name. */
export const fontFamily = (name: string): string => {
	const role = name in ROLES ? ROLES[name as keyof typeof ROLES] : name;
	return `'${role}', ${FALLBACK[name] ?? 'system-ui, sans-serif'}`;
};

export const FAMILY = {
	title: fontFamily('title'),
	text: fontFamily('text'),
	mono: fontFamily('mono'),
	display: fontFamily('display'),
};

let loading: Promise<void> | null = null;

/** Every frame waits for the fonts, so text never renders in a fallback face. */
export function loadFonts(): Promise<void> {
	if (loading) return loading;
	const handle = delayRender('Loading fonts');
	loading = Promise.all(
		Object.entries(LIBRARY).map(async ([family, { file, weights }]) => {
			const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, { weight: `${weights[0]} ${weights[1]}` });
			document.fonts.add(await face.load());
		}),
	).then(() => continueRender(handle));
	return loading;
}
