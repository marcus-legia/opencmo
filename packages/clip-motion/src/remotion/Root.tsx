import React from 'react';
import { Composition } from 'remotion';

import { FPS, frameSize, type MotionJob } from '../job.ts';
import { Explainer, type ExplainerProps } from './Explainer.tsx';
import { loadFonts } from './fonts.ts';

loadFonts();

const PLACEHOLDER: MotionJob = {
	title: 'Explainer',
	code: 'return function Scene() { return null; }',
	beats: [{ say: 'One.' }, { say: 'Two.' }, { say: 'Three.' }],
	format: '16:9',
	duration: 15,
	seed: 0,
};

export function Root() {
	return (
		<Composition
			id="explainer"
			component={Explainer}
			fps={FPS}
			width={1920}
			height={1080}
			durationInFrames={15 * FPS}
			defaultProps={{ job: PLACEHOLDER, compiled: null, probe: false } satisfies ExplainerProps}
			calculateMetadata={({ props }) => {
				const { width, height } = frameSize(props.job.format);
				return { width, height, durationInFrames: props.job.duration * FPS, fps: FPS };
			}}
		/>
	);
}
