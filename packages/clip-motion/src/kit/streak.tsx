import React, { useId } from 'react';

import { smear } from './curves.ts';

export type StreakProps = {
	/** px per frame along the axis (the difference of the position at this frame and the one before). */
	speed: number;
	/** Length of the moving thing along the axis, px: a long word and a short one streak by the same pixels. */
	size: number;
	axis?: 'x' | 'y';
	/** Where the stretch grows from, e.g. '0% 50%' for a word entering from the right. */
	origin?: string;
	style?: React.CSSProperties;
	children?: React.ReactNode;
};

/**
 * `kit.Streak`: directional motion blur plus a speed-linked stretch on its children. Nothing at rest, so resting text is
 * crisp. After pf-type-snap's motion styling (MIT, OpusClip).
 */
export function Streak({ speed, size, axis = 'x', origin = '50% 50%', style, children }: StreakProps) {
	const id = `streak-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
	const { blur, stretch } = smear(Number.isFinite(speed) ? speed : 0, size);
	const moving = blur > 0 || stretch !== 1;
	return (
		<div style={{ transformOrigin: origin, transform: moving ? (axis === 'x' ? `scaleX(${stretch.toFixed(4)})` : `scaleY(${stretch.toFixed(4)})`) : undefined, filter: blur > 0 ? `url(#${id})` : undefined, ...style }}>
			{blur > 0 ? (
				<svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
					<filter id={id} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
						<feGaussianBlur stdDeviation={axis === 'x' ? `${blur} 0` : `0 ${blur}`} />
					</filter>
				</svg>
			) : null}
			{children}
		</div>
	);
}
