/**
 * The global kill switch (docs/architecture/brain.md §9): `OPENCMO_CMO_PAUSED=1` stops the CMO for every founder
 * within one sweep, on top of each founder's own Pause CMO (`profiles.cmo_paused_at`, checked in SQL). The schedule
 * enqueues nothing, the run route claims nothing, and starting work by hand refuses.
 */
export function cmoPausedEverywhere(): boolean {
  return process.env.OPENCMO_CMO_PAUSED === "1";
}

export const PAUSED_EVERYWHERE = "The CMO is paused for maintenance. Your work is kept; try again later.";
