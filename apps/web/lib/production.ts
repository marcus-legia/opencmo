/**
 * Production, wherever it runs: on Vercel `VERCEL_ENV`, self-hosted `OPENCMO_ENV=production`.
 * Everything that must never happen live (fake models, demo data, skipped content checks) asks here,
 * not `NODE_ENV`, which is "production" for every built app, e2e and previews included.
 */
export const isProduction = (): boolean => process.env.VERCEL_ENV === "production" || process.env.OPENCMO_ENV === "production";
