/**
 * The v2 UI flag. Everything of the redesign is behind it; with it unset the app is exactly today's.
 * `NEXT_PUBLIC_` so the shell can branch on the client too; production leaves it unset until release (U9).
 */
export function uiV2(): boolean {
  return process.env.NEXT_PUBLIC_OPENCMO_UI === "v2";
}
