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
	const palette = useMemo(() => makePalette(job.accent), [job.accent]);
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

/** Preview only: once fonts are in, log every tagged box (after camera transforms) for layout.ts. */
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
			for (const element of Array.from(root?.querySelectorAll<HTMLElement>('[data-box]') ?? [])) {
				const rect = element.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) continue;
				const kind = element.dataset.box === 'text' ? 'text' : 'mark';
				const size = Number(element.dataset.size);
				const area = element.offsetWidth * element.offsetHeight;
				const scale = area ? Math.sqrt((rect.width * rect.height) / area) : 1;
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
