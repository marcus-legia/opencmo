# Ferreto

**Find the people already asking for what you built.** Ferreto learns your business from its
website, searches Reddit, Hacker News, Threads and Facebook groups for people describing the
problem you solve, scores each conversation with quotes from it as evidence, and drafts a
reply, a DM or an email that **you** send from your own account.

- **Sales**: people asking, each with the thread's own words as proof, and drafts to reach them.
  Each person is tracked from first contact to customer, so nobody is contacted twice.
- **Post**: a week of posts for X, LinkedIn and Threads, written from what people said; you
  approve it once.
- **Video**: an editor for videos you record yourself: cut by editing the transcript, add
  captions, B-roll and motion, export a version per platform.

Ferreto drafts and assists; it never sends, likes, follows or comments on its own.

The hosted version runs at [ferreto.io](https://ferreto.io). This repository is the full source
of the web app, the editor and the video engine, released under the [GNU AGPL-3.0](LICENSE).
Package, SQL and environment names keep the project's old name (`@opencmo/*`, `OPENCMO_*`).

## Architecture

```
Browser ──► Next.js app + /api/v1 (Vercel) ──► Supabase (Auth · Postgres/RLS · Storage · Realtime)
                                                   ▲
                Modal worker (Python + ffmpeg + Node exporter) ── claims queued tasks
Your Claude ──► MCP server (Modal) ──────────────────┘  the editor's tools, under your own account
```

Every read runs under Row Level Security; every write goes through a Postgres RPC that checks
ownership. [ARCHITECTURE.md](ARCHITECTURE.md) explains the shape and the hard budget every
change must respect: **peak RAM per job < 2 GB**.

## Repository layout

```
apps/web/                  Next.js app: landing, blog, the app at /app, the editor, /api/v1
  lib/cmo/                 Sales, Post and the job engine (jobs/, social/, writer/, loops.ts)
  lib/agent/               the editor Assistant: its tools are editor-core operations
  lib/departments/publish/ posting through Zernio
  lib/generate/            image, video and voice generation, with prompt moderation
  lib/mcp/                 MCP auth: API keys → short-lived user tokens under RLS
  e2e/                     Playwright end-to-end tests
packages/
  engine/                  Python engine and Modal worker: uploads, transcripts, exports (streaming ffmpeg)
  contracts/               JSON contracts shared by Python and TypeScript
  clip-doc/                the editor document: zod schema, validation, migrations
  editor-core/             operations on the document, the only write path
  clip-render/             Canvas 2D renderer, shared by the browser preview and the exporter
  clip-export/             server export: document → MP4
  clip-motion/             motion and explainers (Remotion), rendered on the worker
  clip-icons/ clip-media/ clip-assets/ editor-parity/ skills/ mcp-server/
supabase/                  migrations, pgTAP tests, schema/current.sql (generated)
scripts/                   dev stack (dev.mjs), schema dump, checks
docs/                      agent rules, runbook, research reports (docs/README.md)
```

## Getting started

Requirements: Node 22+, Docker (for the local Supabase stack), the
[Supabase CLI](https://supabase.com/docs/guides/cli), [`uv`](https://docs.astral.sh/uv/),
and FFmpeg/ffprobe.

```bash
npm ci
uv venv --python 3.12 packages/engine/.venv312
uv pip install --python packages/engine/.venv312/bin/python -e 'packages/engine[worker,dev,face]'
cp apps/web/.env.example apps/web/.env.local   # fill in what you need; most keys are optional
npm run dev                                    # web on http://127.0.0.1:3000
```

`npm run dev` checks Docker, starts the local Supabase stack if needed, loads its keys, and
runs Next.js and the worker together. Without the worker, jobs sit in `queued` with no error.

Sign-in is Google OAuth. For local sign-in through the UI, create an OAuth client and set
`SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_GOOGLE_SECRET` (see `supabase/config.toml`);
the test suites sign in with a password through the Auth API and need no Google setup.

AI features need three provider keys: Anthropic (agents and moderation),
fal (images, video, voice and sound, plus image safety checks) and ElevenLabs (transcripts). With `OPENCMO_AGENT_FAKE=1` and `OPENCMO_AI_FAKE=1` the app runs
with deterministic fake providers, which is what the tests use.

## Testing

```bash
npm run db:reset && npm run db:test                 # migrations + pgTAP
cd packages/engine && .venv312/bin/python -m pytest -q && .venv312/bin/python -m ruff check .
cd ../.. && npm run typecheck && npm run build
npm run test:editor-core && npm run test:clip-doc && npm run test:clip-render
cd apps/web && npm run check:contracts && npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full list and what each check covers.

## Contributing

Issues and pull requests are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

Ferreto is licensed under the **GNU Affero General Public License v3.0 only**
([LICENSE](LICENSE)). If you run a modified version as a network service, the AGPL requires you
to offer its source code to that service's users.

Bundled fonts, icons, emoji and animations keep their own licenses — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The Ferreto name and logo are trademarks of the Ferreto project and are not licensed under the
AGPL. Forks must use a different name and logo.
