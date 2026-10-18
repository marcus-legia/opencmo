import assert from "node:assert/strict";

import { cleanupAuthorized } from "./auth";

const env = (extra: Record<string, string>) => ({ NODE_ENV: "production", CRON_SECRET: "cmo-secret", ...extra }) as NodeJS.ProcessEnv;

assert.equal(cleanupAuthorized("Bearer cleanup-secret", env({ CRON_CLEANUP_SECRET: "cleanup-secret" })), true);
assert.equal(cleanupAuthorized("Bearer cmo-secret", env({ CRON_CLEANUP_SECRET: "cleanup-secret" })), false, "the CMO cron secret cannot run cleanup");
assert.equal(cleanupAuthorized("Bearer cmo-secret", env({})), false, "production without its own secret stays closed");
assert.equal(cleanupAuthorized(null, env({ CRON_CLEANUP_SECRET: "cleanup-secret" })), false);

console.log("cleanup cron: only CRON_CLEANUP_SECRET opens it");
