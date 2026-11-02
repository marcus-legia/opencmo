/**
 * Wakes the worker on Modal.
 *
 * HTTP rather than `run_job.spawn()`: spawn is a Python API and this app is TypeScript. The `submit` endpoint in
 * `packages/engine/modal_app.py` is the bridge between the two.
 *
 * This function NEVER throws. The job is already in the database as 'queued'; if Modal misses the wake, `sweep()`
 * (a cron every minute) picks it up. Failing the job's creation because the safety net has to work would trade a
 * 60-second delay for a red error in front of the user.
 */
/** The worker reads the job or task from the database; the wake carries only its id. */
export type WakePayload = { id: string } | { task_id: string };

/**
 * Modal's `submit` takes `{job_id}` OR `{task_id}` (D2 Task 4.1); exports, media probes
 * and generations go through the task branch.
 *
 * A server without the worker token (the MCP server on Modal: it faces the internet, and that
 * token starts any job) calls `wake` instead, with `OPENCMO_WAKE_TOKEN`. That only brings the next
 * `sweep()` forward, which claims the same queued row.
 */
export async function wakeWorker(job: WakePayload): Promise<boolean> {
  const submitUrl = process.env.MODAL_SUBMIT_URL;
  const workerToken = process.env.OPENCMO_WORKER_TOKEN;
  const wakeUrl = process.env.OPENCMO_WAKE_URL;
  const wakeToken = process.env.OPENCMO_WAKE_TOKEN;

  let url: string;
  let body: Record<string, string>;
  if (submitUrl && workerToken) {
    url = submitUrl;
    body = "task_id" in job ? { token: workerToken, task_id: job.task_id } : { token: workerToken, job_id: job.id };
  } else if (wakeUrl && wakeToken) {
    url = wakeUrl;
    body = { token: wakeToken };
  } else {
    console.warn("[modal] no submit or wake URL and token: waiting for sweep()");
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // A cold Modal start can take a few seconds. Past this, give up and leave it to the cron.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error("[modal] wake failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[modal] could not reach the worker", err);
    return false;
  }
}
