import React from 'react';

import { kitError, MarkTag, useLife, type LifeProps } from './context.tsx';
import { ease } from './motion.ts';

export type MarkProps = LifeProps & {
	/** Unique in the scene: the layout report and the jump check know the drawing by this name. */
	name: string;
	/** The box, top-left corner and size in pixels, as for kit.Image. */
	x: number;
	y: number;
	w: number;
	h: number;
	style?: React.CSSProperties;
	children?: React.ReactNode;
};

/**
 * `kit.Mark`: a box for what the scene draws itself (SVG, paths, CSS). The layout report only sees tagged boxes, so
 * without it a hand-drawn subject reads as an empty frame. No entrance of its own: the scene's code owns the motion;
 * only the exit fades, like the other primitives.
 */
export function Mark(props: MarkProps) {
	if (typeof props.name !== 'string' || !props.name.trim()) throw kitError('Mark needs a name (unique in the scene).');
	if (![props.x, props.y, props.w, props.h].every(Number.isFinite) || props.w <= 0 || props.h <= 0) throw kitError(`Mark "${props.name}" needs x, y, w, h in pixels.`);
	const life = useLife(props, ease.out, 0);
	if (!life.visible) return null;
	const target = { x: props.x, y: props.y, w: props.w, h: props.h };
	return (
		<>
			<MarkTag name={`Mark ${props.name}`} target={{ ...target, cx: target.x + target.w / 2, cy: target.y + target.h / 2 }} />
			<div style={{ position: 'absolute', left: target.x, top: target.y, width: target.w, height: target.h, overflow: 'visible', opacity: 1 - life.out, ...props.style }}>
				{props.children}
			</div>
		</>
	);
}
