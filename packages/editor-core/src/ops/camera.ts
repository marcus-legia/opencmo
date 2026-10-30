/**
 * Camera moves on the talking head (`add_camera_move`, plan O4). The recipes and their ranges are AI Producer's
 * (`aip-composition/references/motion-recipes.md`, MIT): an impact shake on the number, a white flash on a hard
 * beat, a whip into the next point, a slow push-in on the build-up, handheld drift on a calm stretch, a pulse on
 * the beat. Each is a pure function of `(t, duration, strength, seed)`, so preview and export draw the same frames.
 *
 * The moves live in the scene mark `camera-moves` (clip seconds) and are BAKED into keyframes by
 * `syncCameraMoves`, which `applyOps` runs after every batch like `syncVoiceovers`: cutting words, `punch_in` or
 * a re-frame changes the pieces under a move, and the keyframes follow without any op having to remember them.
 * Baked tracks carry ids starting `camera-`; a piece with a hand-made track on one of those properties is left
 * alone (two tracks on one property fight).
 *
 * Rules the op enforces (not only the guide): at most one shake or flash per 20 s of clip (more reads as a
 * glitch, and Opus's producer allows one); never where a layout panel shrinks the speaker; the zoom always keeps
 * the frame covered, so a shake never shows the black behind the picture.
 */

import { z } from 'zod';

import { CAMERA_MOVE_KINDS, type CameraMove, type ClipDocument } from '@opencmo/clip-doc';

import { clone, drawId, sceneOf, type Entity } from '../doc';
import { readLayout } from '../layout';
import { round } from '../transcript';
import { OpFailure, type OpContext } from './context';
import { checked } from './project';
import { masters } from './voiceover';
import { quoteRange } from './visuals';

export const CAMERA_MARK = 'camera-moves';
const FLASH_MARK = 'camera-flash';
const TRACK_PREFIX = 'camera-';
/** One shake or flash per this many clip seconds. */
export const ACCENT_GAP = 20;
const ACCENTS = new Set<CameraMove['kind']>(['impact_shake', 'white_flash']);
const PROPERTIES = ['scale', 'offsetX', 'offsetY', 'rotation'] as const;
type Property = (typeof PROPERTIES)[number];

/** Default, min and max seconds of each kind, and the time step its keyframes are sampled at. */
const KINDS: Record<CameraMove['kind'], { duration: [number, number, number]; step: number; strength: number }> = {
	impact_shake: { duration: [0.3, 0.2, 0.45], step: 1 / 30, strength: 0.4 },
	white_flash: { duration: [0.25, 0.1, 0.35], step: 1 / 60, strength: 0.7 },
	whip: { duration: [0.32, 0.25, 0.4], step: 1 / 30, strength: 1 },
	push_in: { duration: [1.5, 0.5, 6], step: 0.1, strength: 0.15 },
	handheld: { duration: [4, 1, 30], step: 0.1, strength: 0.3 },
	beat_pulse: { duration: [0.25, 0.2, 0.3], step: 1 / 30, strength: 0.25 },
};

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** A seeded phase in [0, 2π): the same seed always shakes the same way. */
function phase(seed: number, index: number): number {
	let h = (seed * 2654435761 + index * 40503) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
	return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * Math.PI * 2;
}

type Delta = { scale: number; offsetX: number; offsetY: number; rotation: number };
const ZERO: Delta = { scale: 0, offsetX: 0, offsetY: 0, rotation: 0 };

/** What a move adds to the speaker's pose at `t` seconds into it (0 ≤ t ≤ duration). */
export function moveDelta(move: CameraMove, t: number): Delta {
	const d = move.duration;
	const p = Math.min(1, Math.max(0, t / d));
	const s = move.strength;
	switch (move.kind) {
		case 'impact_shake': {
			const e = (1 - p) ** 2 * lerp(2, 40, s);
			return { scale: 0, offsetX: e * Math.sin(97.3 * t + phase(move.seed, 0)), offsetY: 0.8 * e * Math.sin(73.1 * t + phase(move.seed, 1)), rotation: 0.035 * e * Math.sin(51.7 * t + phase(move.seed, 2)) };
		}
		case 'whip': {
			const wave = Math.sin(Math.PI * p);
			return { ...ZERO, offsetX: (move.direction === 'left' ? -1 : 1) * lerp(80, 160, s) * wave * wave, scale: 0.06 * wave };
		}
		case 'push_in':
			return { ...ZERO, scale: lerp(0.02, 0.4, s) * (1 - (1 - p) ** 3) };
		case 'beat_pulse':
			return { ...ZERO, scale: lerp(0.01, 0.15, s) * Math.sin(Math.PI * p) };
		case 'handheld': {
			const ramp = Math.min(1, t / 0.4, (d - t) / 0.4);
			const a = lerp(1, 12, s) * Math.max(0, ramp);
			const wave = (index: number, f1: number, f2: number) =>
				0.6 * Math.sin(2 * Math.PI * f1 * t + phase(move.seed, index)) + 0.4 * Math.sin(2 * Math.PI * f2 * t + phase(move.seed, index + 1));
			return { scale: 0, offsetX: a * wave(0, 0.31, 0.73), offsetY: a * wave(2, 0.27, 0.61), rotation: 0.04 * a * Math.sin(2 * Math.PI * 0.19 * t + phase(move.seed, 4)) };
		}
		case 'white_flash':
			return ZERO;
	}
}

/** The flash's opacity at `t` seconds into it: a 40 ms rise, then a squared fall. */
export function flashOpacity(move: CameraMove, t: number): number {
	const p = Math.min(1, Math.max(0, t / move.duration));
	return lerp(0.3, 1, move.strength) * Math.min(1, t / 0.04) * (1 - p) ** 2;
}

export const addCameraMoveInput = z
	.object({
		op: z.literal('add_camera_move'),
		kind: z.enum(CAMERA_MOVE_KINDS),
		/** The words the move lands on (copied from <clip_context>); its start is where they begin. */
		quote: z.string().min(1).max(400).optional(),
		/** Clip seconds; wins over `quote`. */
		start: z.number().min(0).optional(),
		/** Seconds; each kind has its own range and default. */
		duration: z.number().positive().max(30).optional(),
		/** 0–1 across the kind's range (shake amplitude 2–40 px, push-in 2–40 %, pulse 1–15 %, flash opacity). */
		strength: z.number().min(0).max(1).optional(),
		/** Whip only: which way the picture throws. */
		direction: z.enum(['left', 'right']).optional(),
		seed: z.number().int().min(0).max(1_000_000).optional(),
	})
	.strict();
type AddCameraMove = z.infer<typeof addCameraMoveInput>;

export const removeCameraMovesInput = z
	.object({
		op: z.literal('remove_camera_moves'),
		/** Clip second: remove the moves playing then. Omit to remove every camera move. */
		at: z.number().min(0).optional(),
	})
	.strict();
type RemoveCameraMoves = z.infer<typeof removeCameraMovesInput>;

type CameraMark = { moves: CameraMove[]; baked: string[] };

function readMark(document: ClipDocument): CameraMark {
	const mark = (sceneOf(document)?.marks as Record<string, unknown> | undefined)?.[CAMERA_MARK] as Partial<CameraMark> | undefined;
	return { moves: Array.isArray(mark?.moves) ? mark.moves : [], baked: Array.isArray(mark?.baked) ? mark.baked : [] };
}

export const readCameraMoves = (document: ClipDocument): CameraMove[] => readMark(document).moves;

function writeMark(scene: Entity, mark: CameraMark): void {
	const marks = { ...((scene.marks as Record<string, unknown> | undefined) ?? {}) };
	if (mark.moves.length || mark.baked.length) marks[CAMERA_MARK] = { moves: [...mark.moves].sort((a, b) => a.start - b.start), baked: mark.baked };
	else delete marks[CAMERA_MARK];
	if (Object.keys(marks).length) scene.marks = marks;
	else delete scene.marks;
}

/** FNV-1a of a track's property and keyframes: ids do not survive a cut's copy, the values do. */
function fingerprint(track: Entity): string {
	const frames = ((track.keyframes as Keyframe[] | undefined) ?? []).map((frame) => `${frame.time}:${frame.value}`).join(',');
	let hash = 0x811c9dc5;
	for (const char of `${String(track.property)}|${frames}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
	return hash.toString(16).padStart(8, '0');
}

const label = (kind: CameraMove['kind']) => kind.replace('_', ' ');

type Owned = (track: Entity) => boolean;
const ownedBy = (baked: string[]): Owned => {
	const set = new Set(baked);
	return (track) => (typeof track.id === 'string' && track.id.startsWith(TRACK_PREFIX)) || (PROPERTIES as readonly string[]).includes(String(track.property)) && set.has(fingerprint(track));
};
/** A hand-made track on a property the moves drive: the piece is not ours to move. */
const handMade = (node: Entity, own: Owned) => ((node.tracks as Entity[] | undefined) ?? []).some((track) => !own(track) && (PROPERTIES as readonly string[]).includes(String(track.property)));

export const addCameraMove = {
	name: 'add_camera_move',
	input: addCameraMoveInput,
	describe: (input: AddCameraMove) => `Add ${/^[aeiou]/.test(input.kind) ? 'an' : 'a'} ${label(input.kind)}`,
	async apply(document: ClipDocument, input: AddCameraMove, ctx?: OpContext) {
		const spec = KINDS[input.kind];
		const [fallback, min, max] = spec.duration;
		const duration = round(Math.min(max, Math.max(min, input.duration ?? fallback)));
		let start = input.start;
		if (start === undefined) {
			if (!input.quote) throw new OpFailure('Give start (clip seconds), or quote: the words the move should land on.');
			start = (await quoteRange(document, ctx, input.quote)).start;
		}
		start = round(start);
		const scene0 = sceneOf(document);
		const workarea = scene0?.workarea as [number, number] | undefined;
		if (workarea && start + duration > workarea[1] + 1e-6) throw new OpFailure(`A ${label(input.kind)} must end inside the clip (it ends at ${workarea[1]} s).`);
		const end = start + duration;

		const pieces = masters(document).filter((video) => {
			const length = video.sourceOut === null ? Infinity : video.sourceOut - video.sourceIn;
			return video.clipStart < end && video.clipStart + length > start;
		});
		if (!pieces.length) throw new OpFailure('There is no speaker on screen then. Camera moves go on the talking-head video.');
		const mark = readMark(document);
		const own = ownedBy(mark.baked);
		if (input.kind !== 'white_flash' && pieces.some((video) => handMade(video.node, own))) {
			throw new OpFailure('The speaker already has keyframes on its zoom or position then. Remove them first, or pick another moment.');
		}
		const panel = readLayout(document).find((range) => range.start < end && range.end > start);
		if (panel) throw new OpFailure(`A layout shrinks the speaker from ${panel.start} s to ${panel.end} s. Put the move where the speaker fills the frame.`);

		const move: CameraMove = {
			kind: input.kind,
			start,
			duration,
			strength: input.strength ?? spec.strength,
			...(input.kind === 'whip' ? { direction: input.direction ?? 'right' } : {}),
			seed: input.seed ?? Math.round(start * 1000) % 1_000_000,
		};
		// Rerunning on the same words replaces the move instead of stacking a second one.
		const kept = mark.moves.filter((other) => !(other.kind === move.kind && other.start < end && other.start + other.duration > start));
		if (ACCENTS.has(move.kind)) {
			const near = kept.find((other) => ACCENTS.has(other.kind) && Math.abs(other.start - start) < ACCENT_GAP);
			if (near) throw new OpFailure(`There is already a ${label(near.kind)} at ${near.start} s. Keep one shake or flash per ${ACCENT_GAP} s of clip, or more reads as a glitch.`);
		}
		if (kept.length >= 64) throw new OpFailure('This clip has too many camera moves. Remove some first.');
		const next = clone(document);
		writeMark(sceneOf(next) as unknown as Entity, { ...mark, moves: [...kept, move] });
		return checked(syncCameraMoves(next), 'That camera move could not be added');
	},
};

export const removeCameraMoves = {
	name: 'remove_camera_moves',
	input: removeCameraMovesInput,
	describe: (input: RemoveCameraMoves) => (input.at === undefined ? 'Remove the camera moves' : 'Remove a camera move'),
	async apply(document: ClipDocument, input: RemoveCameraMoves) {
		const mark = readMark(document);
		const moves = mark.moves;
		const kept = input.at === undefined ? [] : moves.filter((move) => !(move.start <= input.at! && move.start + move.duration >= input.at!));
		if (kept.length === moves.length) {
			if (!moves.length) throw new OpFailure('This clip has no camera moves.');
			throw new OpFailure(`No camera move plays at ${input.at} s. The moves start at ${moves.map((move) => `${move.start} s`).join(', ')}.`);
		}
		const next = clone(document);
		writeMark(sceneOf(next) as unknown as Entity, { ...mark, moves: kept });
		return checked(syncCameraMoves(next), 'The camera moves could not be removed');
	},
};

// ---------------------------------------------------------------------------
// Baking (post pass of applyOps)

type Keyframe = { time: number; value: number };

/** Linear sample of a track at `time` (seconds), or `fallback` without one: enough for the cover check. */
function sampleAt(node: Entity, property: string, time: number, fallback: number): number {
	const track = ((node.tracks as Entity[] | undefined) ?? []).find((item) => item.property === property);
	const frames = ((track?.keyframes as Keyframe[] | undefined) ?? []).filter((frame) => typeof frame.value === 'number').sort((a, b) => a.time - b.time);
	if (!frames.length) return fallback;
	if (time <= frames[0]!.time) return frames[0]!.value;
	for (let index = 1; index < frames.length; index++) {
		const to = frames[index]!;
		if (time <= to.time) {
			const from = frames[index - 1]!;
			return from.value + ((to.value - from.value) * (time - from.time)) / Math.max(1e-6, to.time - from.time);
		}
	}
	return frames.at(-1)!.value;
}

/**
 * Smallest scale at which the box, moved and turned, still covers the frame: every frame corner, seen from the
 * box centre in the box's own axes, must sit inside the scaled half-size. The same margin rule `punch_in` keeps.
 */
function coverScale(box: { x: number; y: number; width: number; height: number }, pose: { offsetX: number; offsetY: number; rotation: number }, frame: { width: number; height: number }): number {
	const cx = box.x + pose.offsetX + box.width / 2;
	const cy = box.y + pose.offsetY + box.height / 2;
	const radians = (pose.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	let need = 0;
	for (const [px, py] of [[0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height]] as const) {
		const dx = px - cx;
		const dy = py - cy;
		const u = cos * dx + sin * dy;
		const v = -sin * dx + cos * dy;
		need = Math.max(need, (2 * Math.abs(u)) / box.width, (2 * Math.abs(v)) / box.height);
	}
	return need;
}

/**
 * Bakes every camera move into keyframes on the master pieces under it, and the flash rects. A document with no
 * moves and nothing baked passes through untouched, so other ops' golden documents never change.
 */
export function syncCameraMoves(input: ClipDocument): ClipDocument {
	const scene0 = sceneOf(input) as unknown as Entity | undefined;
	if (!scene0) return input;
	const { moves, baked: prints } = readMark(input);
	const own = ownedBy(prints);
	const baked =
		masters(input).some((video) => ((video.node.tracks as Entity[] | undefined) ?? []).some(own)) ||
		((scene0.children as Entity[] | undefined) ?? []).some((child) => (child.marks as Record<string, unknown> | undefined)?.[FLASH_MARK]);
	if (!moves.length && !baked) return input;

	const document = clone(input);
	const scene = sceneOf(document) as unknown as Entity;
	// Every timeline is baked, so the scene's id goes into the keys: a duplicated timeline must not share them.
	if (typeof scene.id !== 'string') scene.id = drawId();
	const prefix = `${TRACK_PREFIX}${scene.id as string}-`;
	const frame = { width: Number(scene.width ?? 0), height: Number(scene.height ?? 0) };
	const panels = readLayout(document);
	const fresh = new Set<string>();
	const live = moves.filter((move) => !panels.some((range) => range.start < move.start + move.duration && range.end > move.start));

	for (const [index, video] of masters(document).entries()) {
		const node = video.node;
		const tracks = ((node.tracks as Entity[] | undefined) ?? []).filter((track) => !own(track));
		if (tracks.length) node.tracks = tracks;
		else delete node.tracks;
		if (handMade(node, own)) continue;
		const length = video.sourceOut === null ? Infinity : video.sourceOut - video.sourceIn;
		const pieceEnd = video.clipStart + length;
		const mine = live.filter((move) => move.kind !== 'white_flash' && move.start < pieceEnd && move.start + move.duration > video.clipStart);
		if (!mine.length) continue;

		const base: Record<Property, number> = {
			scale: Number(node.scale ?? node.scaleX ?? 1),
			offsetX: Number(node.offsetX ?? 0),
			offsetY: Number(node.offsetY ?? 0),
			rotation: Number(node.rotation ?? 0),
		};
		const box = { width: Number(node.width ?? frame.width), height: Number(node.height ?? frame.height) };
		const boxAt = (source: number) => ({ ...box, x: sampleAt(node, 'x', source, Number(node.x ?? 0)), y: sampleAt(node, 'y', source, Number(node.y ?? 0)) });
		// Only where the speaker covers the frame at rest: a letterboxed (fit) picture has no edge to protect.
		const covers = (source: number) => coverScale(boxAt(source), base, frame) <= base.scale + 1e-3;

		// Clip times to key: each move's edges and its samples, plus the end of the piece a push-in holds to.
		const times = new Set<number>();
		const from = video.clipStart;
		for (const move of mine) {
			const step = KINDS[move.kind].step;
			const a = Math.max(from, move.start);
			const b = Math.min(pieceEnd, move.start + move.duration);
			for (let t = a; t < b; t += step) times.add(round(t));
			times.add(round(b));
			// The rest pose one frame before: a track holds its first value everywhere before it.
			if (move.start - 1 / 30 > from) times.add(round(move.start - 1 / 30));
			if (move.kind === 'push_in' && Number.isFinite(pieceEnd)) times.add(round(pieceEnd));
		}
		const sorted = [...times].sort((x, y) => x - y);
		const values: Record<Property, Keyframe[]> = { scale: [], offsetX: [], offsetY: [], rotation: [] };
		for (const time of sorted) {
			const delta = { ...ZERO };
			for (const move of mine) {
				const local = time - move.start;
				let part: Delta | null = null;
				if (local >= 0 && local <= move.duration) part = moveDelta(move, local);
				// A push-in holds its close shot until the next cut, where the jump back reads as the cut.
				else if (move.kind === 'push_in' && local > move.duration) part = moveDelta(move, move.duration);
				if (!part) continue;
				for (const key of PROPERTIES) delta[key] += part[key];
			}
			const source = round(video.sourceIn + time - from);
			const pose = { offsetX: base.offsetX + delta.offsetX, offsetY: base.offsetY + delta.offsetY, rotation: base.rotation + delta.rotation };
			let scale = base.scale * (1 + delta.scale);
			if (covers(source)) {
				const need = coverScale(boxAt(source), pose, frame);
				if (need > scale + 1e-6) scale = need + 1e-3;
			}
			values.scale.push({ time: source, value: round(scale) });
			values.offsetX.push({ time: source, value: round(pose.offsetX) });
			values.offsetY.push({ time: source, value: round(pose.offsetY) });
			values.rotation.push({ time: source, value: round(pose.rotation) });
		}
		const owned: Entity[] = [];
		for (const property of PROPERTIES) {
			const frames = values[property];
			if (frames.every((item) => Math.abs(item.value - base[property]) < 1e-3)) continue;
			// Ids are unique in the document and the same on every rebuild, so an unrelated op changes nothing here.
			const key = `${prefix}${index}-${property}`;
			owned.push({ id: key, property, keyframes: frames.map((item, at) => ({ id: `${key}-${at}`, ...item })) });
		}
		for (const item of owned) fresh.add(fingerprint(item));
		if (owned.length) node.tracks = [...((node.tracks as Entity[] | undefined) ?? []), ...owned];
	}

	// Flashes: one white rect each, right above the picture (captions stay on top, `captionsOnTop`).
	const children = ((scene.children as Entity[] | undefined) ?? []).filter((child) => !(child.marks as Record<string, unknown> | undefined)?.[FLASH_MARK]);
	for (const [index, move] of live.filter((item) => item.kind === 'white_flash').entries()) {
		const times = new Set<number>([0.04, move.duration].map(round));
		for (let t = 0; t < move.duration; t += KINDS.white_flash.step) times.add(round(t));
		const key = `${prefix}flash-${index}`;
		const keyframes = [...times].sort((a, b) => a - b).map((time, at) => ({ id: `${key}-${at}`, time, value: round(flashOpacity(move, time)) }));
		children.push({
			id: key,
			kind: 'rect',
			name: 'Flash',
			x: 0,
			y: 0,
			width: frame.width,
			height: frame.height,
			fill: '#FFFFFF',
			start: move.start,
			end: round(move.start + move.duration),
			marks: { [FLASH_MARK]: true },
			tracks: [{ id: `${key}-opacity`, property: 'opacity', keyframes }],
		});
	}
	if (children.length) scene.children = children;
	else delete scene.children;
	writeMark(scene, { moves, baked: [...fresh].sort() });
	return document;
}
