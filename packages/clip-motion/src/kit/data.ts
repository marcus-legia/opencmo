/** Deterministic data generators for the marks, so a scene never needs real data to look right. */

import { random } from './motion.ts';

export type Spectrum = {
	cols: number;
	rows: number;
	/** cols × rows values in 0..1, column-major; row 0 is the highest frequency. */
	cells: number[];
	/** Brightest cell per time slice: the "constellation". x, y normalised (y down). */
	peaks: { c: number; r: number; x: number; y: number; v: number }[];
};

export function spectrogram(seed = 1, options: { cols?: number; rows?: number; peaks?: number } = {}): Spectrum {
	const cols = Math.max(8, Math.min(120, Math.round(options.cols ?? 48)));
	const rows = Math.max(6, Math.min(60, Math.round(options.rows ?? 24)));
	const peakCount = Math.max(1, Math.min(cols, Math.round(options.peaks ?? 16)));
	const rnd = random(seed);
	const phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
	const cells = new Array<number>(cols * rows).fill(0);
	for (let c = 0; c < cols; c++) {
		const pulse = 0.35 + 0.65 * Math.sin(c * 0.45 + phase[0]!) ** 2;
		const base = 0.16 + 0.08 * Math.sin(c * 0.19 + phase[1]!) + 0.04 * Math.sin(c * 0.83 + phase[2]!);
		for (let r = 0; r < rows; r++) {
			const freq = 1 - (r + 0.5) / rows;
			let v = rnd() ** 2 * 0.35;
			for (let h = 1; h <= 5; h++) {
				const centre = base * h;
				if (centre > 0.98) break;
				const distance = (freq - centre) * rows;
				v += ((pulse * (0.55 + 0.45 * rnd())) / h ** 0.6) * 0.75 * Math.exp(-(distance * distance) / 0.7);
			}
			cells[c * rows + r] = Math.min(1, v);
		}
	}
	// One peak per time slice, cycling through low, mid and high bands so the constellation spreads.
	const bands = 3;
	const peaks: Spectrum['peaks'] = [];
	for (let k = 0; k < peakCount; k++) {
		const start = Math.floor((k * cols) / peakCount);
		const end = Math.max(start + 1, Math.floor(((k + 1) * cols) / peakCount));
		const band = [0, 2, 1][k % bands]!;
		const rowFrom = Math.floor(((bands - 1 - band) * rows) / bands);
		const rowTo = Math.floor(((bands - band) * rows) / bands);
		let best = { c: start, r: rowFrom, v: -1 };
		for (let c = start; c < end; c++) {
			for (let r = rowFrom; r < rowTo; r++) {
				const v = cells[c * rows + r]!;
				if (v > best.v) best = { c, r, v };
			}
		}
		cells[best.c * rows + best.r] = Math.max(best.v, 0.92);
		peaks.push({ ...best, v: cells[best.c * rows + best.r]!, x: (best.c + 0.5) / cols, y: (best.r + 0.5) / rows });
	}
	return { cols, rows, cells, peaks };
}

/** Points with a linear trend and noise, in plot coordinates (0..1, y up). */
export function trend(seed = 1, options: { n?: number; slope?: number; spread?: number } = {}): { x: number; y: number }[] {
	const n = Math.max(2, Math.min(400, Math.round(options.n ?? 36)));
	const slope = options.slope ?? 0.7;
	const spread = options.spread ?? 0.08;
	const rnd = random(seed);
	const offset = 0.5 - slope / 2;
	return Array.from({ length: n }, () => {
		const x = 0.05 + rnd() * 0.9;
		const noise = (rnd() + rnd() + rnd() - 1.5) * spread * 1.6;
		return { x, y: Math.min(0.97, Math.max(0.03, offset + slope * x + noise)) };
	});
}
