import { MotionJobSchema, type MotionJob } from './job.ts';
import type { Prepared } from './render.ts';

export function parseJob(input: unknown): { ok: true; job: MotionJob } | { ok: false; message: string } {
	const parsed = MotionJobSchema.safeParse(input);
	if (parsed.success) return { ok: true, job: parsed.data };
	const issue = parsed.error.issues[0];
	return { ok: false, message: issue ? `${issue.path.join('.') || 'job'}: ${issue.message}` : 'Invalid job.' };
}

/** Compile + guard the scene code (A2). Throws MotionCodeFailure. */
export function prepare(job: MotionJob): Prepared {
	return { job, compiled: null };
}
