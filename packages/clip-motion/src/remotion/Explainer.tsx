import React from 'react';
import { AbsoluteFill } from 'remotion';

import type { MotionJob } from '../job.ts';
import { FAMILY } from './fonts.ts';

export type ExplainerProps = {
	job: MotionJob;
	/** Scene code after compile + guard (render.ts); null renders the placeholder. */
	compiled: string | null;
	/** Preview only: report tagged boxes for the layout report. */
	probe: boolean;
};

export function Explainer({ job }: ExplainerProps) {
	return (
		<AbsoluteFill style={{ background: '#0B1426', alignItems: 'center', justifyContent: 'center' }}>
			<div style={{ fontFamily: FAMILY.title, fontSize: 96, color: '#E8EEF8' }}>{job.title}</div>
		</AbsoluteFill>
	);
}
