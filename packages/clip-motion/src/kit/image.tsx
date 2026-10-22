import React from 'react';
import { Img, staticFile } from 'remotion';

import { STAGED_ASSET, type MotionAsset } from '../job.ts';
import { kitError, MarkTag, useArea, useLife, type AreaProp, type LifeProps } from './context.tsx';
import { ease } from './motion.ts';

export type ImageProps = LifeProps & {
	name: string;
	/** The box, top-left corner and size in pixels (or an area); the image fills it by `fit`. */
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	area?: AreaProp;
	fit?: 'cover' | 'contain';
	radius?: number;
	style?: React.CSSProperties;
};

/**
 * `kit.Image` for this job's assets. The `<img>` is kit code, so it may load a bundle file or a data URI; scene code
 * cannot (no `R.Img`, no `staticFile`). Node wrote each asset into the bundle before Chromium opened (`job-assets.ts`).
 */
export function makeImage(assets: readonly MotionAsset[]) {
	const byName = new Map(assets.map((asset) => [asset.name, asset]));
	const names = assets.map((asset) => asset.name);
	return function Image(props: ImageProps) {
		const asset = typeof props.name === 'string' ? byName.get(props.name) : undefined;
		if (!asset) {
			throw kitError(`unknown image "${String(props.name)}": ${names.length ? `this job has ${names.map((name) => `"${name}"`).join(', ')}` : 'this job has no images (add them with assets)'}.`);
		}
		const src = asset.src.startsWith(STAGED_ASSET) ? staticFile(asset.src.slice(STAGED_ASSET.length)) : asset.src.startsWith('data:') ? asset.src : null;
		if (!src) throw kitError(`image "${asset.name}" was not prepared for the render.`);
		const fromArea = useArea(props.area, 'hero');
		const life = useLife(props, ease.hero, 18);
		const target = props.x !== undefined && props.y !== undefined && props.w !== undefined && props.h !== undefined ? { x: props.x, y: props.y, w: props.w, h: props.h } : fromArea;
		if (![target.x, target.y, target.w, target.h].every(Number.isFinite) || target.w <= 0 || target.h <= 0) throw kitError('Image needs x, y, w, h in pixels or an area.');
		if (props.fit !== undefined && props.fit !== 'cover' && props.fit !== 'contain') throw kitError('Image fit is "cover" or "contain".');
		if (!life.visible) return null;
		const scale = 0.96 + 0.04 * life.pop;
		return (
			<>
				<MarkTag name={`Image ${asset.name}`} target={{ ...target, cx: target.x + target.w / 2, cy: target.y + target.h / 2 }} />
				<div
					style={{
						position: 'absolute',
						left: target.x,
						top: target.y,
						width: target.w,
						height: target.h,
						overflow: 'hidden',
						borderRadius: props.radius ?? 0,
						opacity: life.opacity,
						transform: `scale(${scale})`,
						...props.style,
					}}
				>
					<Img src={src} style={{ width: '100%', height: '100%', objectFit: props.fit ?? 'cover', display: 'block' }} />
				</div>
			</>
		);
	};
}
