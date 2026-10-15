import { continueRender, delayRender, staticFile } from 'remotion';

import { setIconLibrary } from '../kit/icons.ts';

/** Same names as `ICONS_FILE` / `LOTTIE_DIR` in src/assets.ts (that module is Node-only). */
export const ICONS_URL = 'icons.json';
export const LOTTIE_URL = 'lottie';

let loading: Promise<void> | null = null;

/** Every frame waits for the icon data, so `<Icon>` can look names up synchronously. */
export function loadIcons(): Promise<void> {
	if (loading) return loading;
	const handle = delayRender('Loading icons');
	loading = fetch(staticFile(ICONS_URL))
		.then((response) => {
			if (!response.ok) throw new Error(`icons.json: HTTP ${response.status}`);
			return response.json();
		})
		.then((data) => {
			setIconLibrary(data);
			continueRender(handle);
		});
	return loading;
}

const lotties = new Map<string, Promise<unknown>>();

/** A built-in Lottie animation from the bundle, fetched once per page. */
export function lottieData(name: string): Promise<unknown> {
	let found = lotties.get(name);
	if (!found) {
		found = fetch(staticFile(`${LOTTIE_URL}/${name}.json`)).then((response) => {
			if (!response.ok) throw new Error(`Lottie "${name}": HTTP ${response.status}`);
			return response.json();
		});
		lotties.set(name, found);
	}
	return found;
}
