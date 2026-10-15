/**
 * Icon lookup for `<Icon>`: the 16 v1 paths first (their look is in the golden stills), then every Lucide
 * icon of `packages/clip-icons` (24×24 box, stroked). The Lucide data is loaded into the page once
 * (`src/remotion/assets.ts`) before any frame renders.
 */

/** v1 paths, drawn for this kit. */
export const V1_ICONS: Record<string, string> = {
	mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8',
	music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
	phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M11 18h2',
	search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z M16 16l5 5',
	database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
	wave: 'M2 12h2 M6 8v8 M10 4v16 M14 7v10 M18 10v4 M22 12h-2',
	bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
	user: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M4 21a8 8 0 0 1 16 0',
	lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
	server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
	cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8Z',
	chart: 'M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6',
	clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z M12 7v5l3 3',
	globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z M3 12h18 M12 3c3 3.5 3 14.5 0 18 M12 3c-3 3.5-3 14.5 0 18',
	key: 'M8 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z M11 10h10 M18 10v3 M15 10v2',
	play: 'M7 4l13 8-13 8Z',
};

/** v1 list, kept as `kit.icons`; any Lucide name works too. */
export const ICON_NAMES = Object.keys(V1_ICONS);

type IconLibrary = { icons: Record<string, { d: string }> };

let library: Record<string, { d: string }> | null = null;

/** Called by the page loader once `icons.json` is in, and by tests. */
export function setIconLibrary(data: IconLibrary): void {
	library = data.icons;
}

export function iconLibraryLoaded(): boolean {
	return library !== null;
}

/** The path of `name`, or null when neither set has it. */
export function iconPath(name: string): string | null {
	return V1_ICONS[name] ?? library?.[name]?.d ?? null;
}

function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let previous = row[0]!;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const current = row[j]!;
			row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
			previous = current;
		}
	}
	return row[b.length]!;
}

/** Up to `limit` known names closest to a misspelt one: a name containing it first, then by edit distance. */
export function closestIcons(name: string, limit = 5): string[] {
	const wanted = name.toLowerCase().trim();
	const names = [...new Set([...ICON_NAMES, ...Object.keys(library ?? {})])];
	return names
		.map((candidate) => ({ candidate, score: candidate.includes(wanted) || wanted.includes(candidate) ? -1 : distance(wanted, candidate) }))
		.sort((a, b) => a.score - b.score || a.candidate.length - b.candidate.length || a.candidate.localeCompare(b.candidate))
		.slice(0, limit)
		.map((item) => item.candidate);
}
