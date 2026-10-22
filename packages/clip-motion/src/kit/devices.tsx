/**
 * Device frames for product moments: a phone and a browser window drawn by the kit, holding one of the job's images
 * (`image`, an asset name) or children laid out in the screen's own pixels. Our own drawing: proportions from the
 * devices, colours and shadows from the theme.
 */

import React from 'react';
import { useVideoConfig } from 'remotion';

import { kitError, MarkTag, useLife, usePalette, useTheme, type LifeProps } from './context.tsx';
import type { ImageProps } from './image.tsx';
import { ease } from './motion.ts';
import { alpha } from './theme.ts';

export type DeviceProps = LifeProps & {
	/** An asset name of this job (`kit.images`), shown edge to edge on the screen. */
	image?: string;
	/** Centre of the device, in pixels. */
	x: number;
	y: number;
	/** Outer width in pixels; the height follows the device. */
	w: number;
	scale?: number;
	/** Degrees, around the centre. */
	rotate?: number;
	/** Drawn on the screen: positions are pixels from the screen's top-left corner, clipped to it. */
	children?: React.ReactNode;
};

/** A phone screen is 9:19.5 (modern phones); the bezel is 4.5% of the width. */
export const PHONE = { screen: 19.5 / 9, bezel: 0.045, radius: 0.16 } as const;
/** A browser window: a 40 px bar at 1080 (scaled with the frame's short side) over a 16:10 page. */
export const BROWSER = { bar: 40, page: 10 / 16, radius: 14 } as const;

type Box = { x: number; y: number; w: number; h: number };

function check(name: string, props: DeviceProps) {
	for (const key of ['x', 'y', 'w'] as const) {
		if (!Number.isFinite(props[key])) throw kitError(`${name} needs ${key} in pixels.`);
	}
	if (props.w <= 0) throw kitError(`${name} needs a positive w.`);
	for (const key of ['scale', 'rotate'] as const) {
		if (props[key] !== undefined && !Number.isFinite(props[key])) throw kitError(`${name} ${key} must be a number.`);
	}
}

/** The shadow a device casts: soft and warm on paper, a faint glow under the navy field. */
function useShadow(): string {
	const theme = useTheme();
	const palette = usePalette();
	return theme === 'paper' ? '0 30px 70px rgba(40, 32, 20, 0.22), 0 8px 18px rgba(40, 32, 20, 0.12)' : `0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px ${alpha(palette.ink, 0.12)}`;
}

/** `statusBar`: px at the top of the screen kept for the phone's status bar, so an image starts below the island. */
function Screen({ box, radius, image, statusBar = 0, children, Image }: { box: Box; radius: number; image?: string; statusBar?: number; children?: React.ReactNode; Image: (props: ImageProps) => React.ReactNode }) {
	return (
		<div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: radius, overflow: 'hidden', background: statusBar ? '#FFFFFF' : undefined }}>
			{image !== undefined ? <Image name={image} x={0} y={statusBar} w={box.w} h={box.h - statusBar} /> : null}
			{children}
		</div>
	);
}

/** `kit.Phone` and `kit.Browser`, bound to this job's images. */
export function makeDevices(Image: (props: ImageProps) => React.ReactNode) {
	function Frame({ name, props, outer, screen, radius, screenRadius, body, chrome, statusBar }: { name: string; props: DeviceProps; outer: Box; screen: Box; radius: number; screenRadius: number; body: string; chrome?: React.ReactNode; statusBar?: number }) {
		const life = useLife(props, ease.hero, 18);
		const shadow = useShadow();
		if (!life.visible) return null;
		const scale = (props.scale ?? 1) * (0.94 + 0.06 * life.pop);
		return (
			<div style={{ position: 'absolute', inset: 0, opacity: life.opacity, transformOrigin: `${props.x}px ${props.y}px`, transform: `rotate(${props.rotate ?? 0}deg) scale(${scale})` }}>
				<MarkTag name={name} target={{ ...outer, cx: props.x, cy: props.y }} />
				<div style={{ position: 'absolute', left: outer.x, top: outer.y, width: outer.w, height: outer.h, borderRadius: radius, background: body, boxShadow: shadow }} />
				{chrome}
				<MarkTag name={`${name} screen`} target={{ ...screen, cx: screen.x + screen.w / 2, cy: screen.y + screen.h / 2 }} />
				<Screen box={screen} radius={screenRadius} image={props.image} statusBar={statusBar} Image={Image}>
					{props.children}
				</Screen>
			</div>
		);
	}

	function Phone(props: DeviceProps) {
		check('Phone', props);
		const theme = useTheme();
		const bezel = props.w * PHONE.bezel;
		const screenW = props.w - 2 * bezel;
		const screenH = screenW * PHONE.screen;
		const outer = { x: props.x - props.w / 2, y: props.y - (screenH + 2 * bezel) / 2, w: props.w, h: screenH + 2 * bezel };
		const screen = { x: outer.x + bezel, y: outer.y + bezel, w: screenW, h: screenH };
		const radius = props.w * PHONE.radius;
		const island = { w: screenW * 0.3, h: screenW * 0.085 };
		const chrome = (
			<div style={{ position: 'absolute', left: props.x - island.w / 2, top: screen.y + screenW * 0.035, width: island.w, height: island.h, borderRadius: island.h, background: '#05070C', zIndex: 2 }} />
		);
		// Web pages and app screenshots start under the status bar on a real phone, not under the island.
		const statusBar = screenW * 0.14;
		return <Frame name="Phone" props={props} outer={outer} screen={screen} radius={radius} screenRadius={radius - bezel} body={theme === 'paper' ? '#1D2733' : '#0B0F17'} statusBar={statusBar} chrome={<div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>{chrome}</div>} />;
	}

	function Browser(props: DeviceProps) {
		check('Browser', props);
		const palette = usePalette();
		const theme = useTheme();
		const { width, height } = useVideoConfig();
		const bar = BROWSER.bar * (Math.min(width, height) / 1080);
		const pageH = props.w * BROWSER.page;
		const outer = { x: props.x - props.w / 2, y: props.y - (bar + pageH) / 2, w: props.w, h: bar + pageH };
		const screen = { x: outer.x, y: outer.y + bar, w: props.w, h: pageH };
		const radius = BROWSER.radius * (Math.min(width, height) / 1080);
		const barColor = theme === 'paper' ? '#E4DCCD' : '#1A2338';
		const dot = bar * 0.28;
		const chrome = (
			<div style={{ position: 'absolute', left: outer.x, top: outer.y, width: outer.w, height: bar, borderRadius: `${radius}px ${radius}px 0 0`, background: barColor }}>
				{['#FF5F57', '#FEBC2E', '#28C840'].map((color, i) => (
					<div key={color} style={{ position: 'absolute', left: bar * 0.5 + i * dot * 1.7, top: (bar - dot) / 2, width: dot, height: dot, borderRadius: dot, background: color }} />
				))}
				<div style={{ position: 'absolute', left: outer.w * 0.25, top: bar * 0.22, width: outer.w * 0.5, height: bar * 0.56, borderRadius: bar, background: alpha(palette.ink, theme === 'paper' ? 0.08 : 0.12) }} />
			</div>
		);
		return <Frame name="Browser" props={props} outer={outer} screen={screen} radius={radius} screenRadius={0} body={barColor} chrome={chrome} />;
	}

	return { Phone, Browser };
}
