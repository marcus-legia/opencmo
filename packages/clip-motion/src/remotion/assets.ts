import { continueRender, delayRender, staticFile } from 'remotion';

import { setIconLibrary } from '../kit/icons.ts';

/** Same name as `ICONS_FILE` in src/assets.ts (that module is Node-only). */
export const ICONS_URL = 'icons.json';

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
