/**
 * Copies the clip fonts (`packages/clip-media/fonts`) into `public/` so the web serves them from its own
 * origin (CSP `font-src 'self'`). Runs in `predev`/`prebuild` and in `scripts/dev.mjs`; the target is in
 * `.gitignore`.
 *
 * Copies everything every time (a few MB, under a second): skipping by mtime would keep a file deleted at
 * the source alive at the target forever.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(WEB, '..', '..', 'packages', 'clip-media');

const from = join(MEDIA, 'fonts');
if (!existsSync(from)) throw new Error(`Missing ${from}: the clip fonts live in packages/clip-media.`);
const to = join(WEB, 'public', 'fonts');
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
// The Lottie pack was removed (2026-10-24); a copy left by an older checkout must not be served.
rmSync(join(WEB, 'public', 'lottie'), { recursive: true, force: true });
