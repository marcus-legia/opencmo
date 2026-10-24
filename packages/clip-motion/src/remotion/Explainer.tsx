import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import * as Remotion from 'remotion';
import { AbsoluteFill, continueRender, delayRender, useVideoConfig } from 'remotion';

import { buildScene, sceneError } from '../code/run.ts';
import { DEFAULT_PERSONALITY, DEFAULT_THEME, type MotionJob } from '../job.ts';
import { MotionContext, PaletteContext, ThemeContext } from '../kit/context.tsx';
import { MOTION } from '../kit/personality.ts';
import { makeKit } from '../kit/index.ts';
import { makePalette } from '../kit/theme.ts';
import { FAMILY } from './fonts.ts';
import { LAYOUT_LOG } from './layout-log.ts';

export type ExplainerProps = {
	job: MotionJob;
	/** Scene code after compile + guard (render.ts); null renders the placeholder. */
	compiled: string | null;
	/** Preview only: report tagged boxes for the layout report. */
	probe: boolean;
};

/** The part of Remotion a scene may use: time, layout and interpolation, no media or render control. */
const R = Object.freeze({
	AbsoluteFill: Remotion.AbsoluteFill,
	Sequence: Remotion.Sequence,
	Series: Remotion.Series,
	Freeze: Remotion.Freeze,
	Loop: Remotion.Loop,
	useCurrentFrame: Remotion.useCurrentFrame,
	useVideoConfig: Remotion.useVideoConfig,
	interpolate: Remotion.interpolate,
	interpolateColors: Remotion.interpolateColors,
	spring: Remotion.spring,
	measureSpring: Remotion.measureSpring,
	Easing: Remotion.Easing,
	random: Remotion.random,
});

class SceneBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
	override state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	override render() {
		// Rethrown with the marker: the render fails and the CLI exits 4 with this message.
		if (this.state.error) throw sceneError(String(this.state.error.message ?? this.state.error).replace(/^\[scene-code\]\s*/, ''));
		return this.props.children;
	}
}

export function Explainer({ job, compiled, probe }: ExplainerProps) {
	const { width, height } = useVideoConfig();
	const palette = useMemo(() => makePalette(job.accent, job.theme), [job.accent, job.theme]);
	const motion = useMemo(() => {
		const personality = job.personality ?? DEFAULT_PERSONALITY;
		return { personality, style: MOTION[personality], explicit: job.personality !== undefined };
	}, [job.personality]);
	const kit = useMemo(() => makeKit(job, { width, height }), [job, width, height]);
	const Scene = useMemo(() => (compiled ? buildScene(compiled, React, R, kit) : null), [compiled, kit]);
	return (
		<PaletteContext.Provider value={palette}>
			<ThemeContext.Provider value={job.theme ?? DEFAULT_THEME}>
			<MotionContext.Provider value={motion}>
			<AbsoluteFill style={{ background: palette.field }}>
				{Scene ? (
					<SceneBoundary>
						<Scene />
					</SceneBoundary>
				) : (
					<AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
						<div style={{ fontFamily: FAMILY.title, fontSize: 96, color: palette.text }}>{job.title}</div>
					</AbsoluteFill>
				)}
				{probe ? <LayoutProbe /> : null}
			</AbsoluteFill>
			</MotionContext.Provider>
			</ThemeContext.Provider>
		</PaletteContext.Provider>
	);
}

export type ProbedBox = { kind: 'text' | 'mark'; name: string; x: number; y: number; w: number; h: number; size?: number };

/**
 * The part of a tagged box the viewer can see: clipped by every ancestor that hides overflow (a masked row, a phone
 * screen), and nothing when the box or an ancestor is fully transparent.
 */
function visiblePart(element: HTMLElement, rect: DOMRect, root: HTMLElement | null): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
	let left = rect.left;
	let top = rect.top;
	let right = rect.right;
	let bottom = rect.bottom;
	for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (Number(style.opacity) < 0.05) return null;
		if (node !== element && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
			const clip = node.getBoundingClientRect();
			left = Math.max(left, clip.left);
			top = Math.max(top, clip.top);
			right = Math.min(right, clip.right);
			bottom = Math.min(bottom, clip.bottom);
		}
	}
	return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}

/** Preview only: once fonts are in, log every visible tagged box (after camera transforms) for layout.ts. */
function LayoutProbe() {
	const ref = useRef<HTMLDivElement>(null);
	const [handle] = useState(() => delayRender('Measuring layout'));
	useEffect(() => {
		let done = false;
		document.fonts.ready.then(() => {
			if (done) return;
			const root = ref.current?.parentElement;
			const origin = root?.getBoundingClientRect() ?? { left: 0, top: 0 };
			const boxes: ProbedBox[] = [];
			const frame = root?.getBoundingClientRect();
			for (const element of Array.from(root?.querySelectorAll<HTMLElement>('[data-box]') ?? [])) {
				// MotionBlur's earlier samples are ghosts of the same element: only its newest sample is measured.
				if (element.closest('[data-ghost]')) continue;
				const full = element.getBoundingClientRect();
				if (full.width === 0 || full.height === 0) continue;
				const rect = visiblePart(element, full, root ?? null);
				// Hidden by a mask (a row window), faded out, or wholly off the frame: the viewer does not see it.
				if (!rect || rect.width < 1 || rect.height < 1) continue;
				if (frame && (rect.right <= frame.left || rect.left >= frame.right || rect.bottom <= frame.top || rect.top >= frame.bottom)) continue;
				const kind = element.dataset.box === 'text' ? 'text' : 'mark';
				const size = Number(element.dataset.size);
				const area = element.offsetWidth * element.offsetHeight;
				const scale = area ? Math.sqrt((full.width * full.height) / area) : 1;
				boxes.push({ kind, name: element.dataset.name ?? '', x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height, ...(kind === 'text' && size ? { size: size * scale } : {}) });
			}
			console.log(`${LAYOUT_LOG}${JSON.stringify(boxes)}`);
			continueRender(handle);
		});
		return () => {
			done = true;
		};
	}, [handle]);
	return <div ref={ref} style={{ display: 'none' }} />;
}
