# clip-media

Clip fonts — **one copy** for every place that draws text (R7c).

| Folder | Read by |
|---|---|
| `fonts/` (32 families, OFL/Apache) | clip-render (Node + browser), clip-export, clip-motion, parity, the agent eval, web (`/fonts/`) |

The web does not read from here directly: CSP `font-src 'self'` needs same-origin fonts, so
`apps/web/scripts/sync-media.mts` copies the folder into `apps/web/public/` before `next dev` /
`next build` (the target is in `.gitignore`). Copied, not symlinked: a Vercel build does not keep a
symlink that points outside the app folder.

The worker on Modal reads it through `OPENCMO_EDITOR_FONTS`.

Not an npm workspace: nothing imports it as a module, files are only read.
Add a font with `apps/web/scripts/fetch-fonts.mts`, which writes straight here.

The Lottie pack (`lottie/`, with the Noto animated emoji) was removed on 2026-10-24 with Lottie support.
