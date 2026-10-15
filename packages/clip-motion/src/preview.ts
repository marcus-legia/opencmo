import type { MotionJob, PreviewResult } from './job.ts';
import type { Log } from './render.ts';

/** Stills + layout report (A6). */
export async function previewJob(_job: MotionJob, _outdir: string, _options: { log?: Log } = {}): Promise<PreviewResult> {
	return { ok: true, stills: [], issues: [], estimated: true };
}
