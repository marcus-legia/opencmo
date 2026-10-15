import React, { useEffect, useState } from 'react';
import { Lottie as RemotionLottie, type LottieAnimationData } from '@remotion/lottie';
import { cancelRender, continueRender, delayRender, Sequence, useVideoConfig } from 'remotion';

import { lottieData } from '../remotion/assets.ts';
import { kitError, MarkTag, useLife, type LifeProps } from './context.tsx';
import { ease } from './motion.ts';
import { LOTTIE_NAMES } from './lotties.ts';

const KNOWN = new Set(LOTTIE_NAMES);

export type LottieProps = LifeProps & { name: string; x?: number; y?: number; size?: number; loop?: boolean; speed?: number };

function suggestions(name: string): string {
	const word = name.replace(/^emoji\//, '').toLowerCase();
	const close = LOTTIE_NAMES.filter((candidate) => candidate.includes(word) || word.includes(candidate.replace(/^emoji\//, ''))).slice(0, 5);
	return close.length ? `closest names are ${close.join(', ')}` : 'search them with find_lotties';
}

/**
 * A built-in Lottie animation (`walk`, `heart-beat`, `emoji/brain`…): the CC0 OpenCMO pack and the Noto
 * animated emoji, bundled with the renderer. It plays from `at` in step with the frame, so every render of a
 * job is identical; it pops in like the other marks.
 */
export function Lottie(props: LottieProps) {
	if (typeof props.name !== 'string' || !KNOWN.has(props.name)) throw kitError(`unknown animation "${String(props.name)}": ${suggestions(String(props.name))}.`);
	if (props.speed !== undefined && !(props.speed > 0 && props.speed <= 4)) throw kitError('Lottie speed must be between 0 and 4.');
	const { width, height } = useVideoConfig();
	const [data, setData] = useState<LottieAnimationData | null>(null);
	const [handle] = useState(() => delayRender(`Loading animation ${props.name}`));
	useEffect(() => {
		let live = true;
		lottieData(props.name)
			.then((json) => {
				if (live) setData(json as LottieAnimationData);
				continueRender(handle);
			})
			.catch((error: unknown) => cancelRender(error));
		return () => {
			live = false;
		};
	}, [props.name, handle]);
	const life = useLife(props, ease.hero, 14);
	const size = props.size ?? Math.round(Math.min(width, height) * 0.28);
	const x = props.x ?? width / 2;
	const y = props.y ?? height / 2;
	if (![x, y, size].every(Number.isFinite)) throw kitError('Lottie needs x, y and size in pixels.');
	if (!life.visible) return null;
	const target = { x: x - size / 2, y: y - size / 2, w: size, h: size, cx: x, cy: y };
	return (
		<>
			<MarkTag name={`Lottie ${props.name}`} target={target} />
			<div style={{ position: 'absolute', left: target.x, top: target.y, width: size, height: size, opacity: life.opacity, transform: `scale(${0.86 + 0.14 * life.p})` }}>
				{data ? (
					<Sequence from={props.at ?? 0} layout="none">
						<RemotionLottie animationData={data} loop={props.loop ?? true} playbackRate={props.speed ?? 1} style={{ width: size, height: size }} />
					</Sequence>
				) : null}
			</div>
		</>
	);
}
