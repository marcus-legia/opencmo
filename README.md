# OpenCMO

**An AI CMO for solo founders.** Paste your website, and OpenCMO learns your business, plans
the week, and drafts the work across three departments — you approve everything that goes out.

- **Video** — turn your own long-form video into vertical 9:16 clips with captions and face
  tracking, polish them in a full timeline editor, and write per-platform captions.
- **Post** — draft X posts from your strategy; you review, approve and publish to your own account.
- **Sales** — find Reddit threads where people need what you sell, score them with evidence,
  and draft replies that **you** post yourself.

OpenCMO drafts and assists; it never posts, likes, follows or comments on its own.

The hosted version runs at [opencmo.io](https://opencmo.io). This repository is the full source
of the web app, the editor and the video engine, released under the
[GNU AGPL-3.0](LICENSE).

## Architecture

```
Browser ──► Next.js app + /api/v1 (Vercel) ──► Supabase (Auth · Postgres/RLS · Storage · Realtime)
                                                   ▲
                       Modal worker (Python + ffmpeg + Node exporter) ── claims queued tasks
Your Claude ──► MCP server (Modal) ──────────────────┘  same tools as the in-app Assistant
```

Every read runs under Row Level Security; every write goes through a Postgres RPC that checks
ownership. The database schema is the contract between the web app, the worker and the MCP
server.

## Repository layout

```
opencmo/
├── apps/
│   └── web/                    Next.js app: landing, workspace, AI CMO, clip editor, /api/v1
│       ├── app/                routes (App Router); app/api/v1 = the public API
│       ├── components/         UI, including the editor (components/editor)
│       ├── lib/
│       │   ├── agent/          the editor Assistant — its tools are editor-core operations
│       │   ├── cmo/            the AI CMO: onboarding, jobs, schedules and its agents
│       │   ├── generate/       AI image/video/voice generation, with prompt moderation
│       │   ├── mcp/            MCP auth: API keys → short-lived user tokens under RLS
│       │   └── supabase/       Supabase clients (admin.ts = service role, server-only)
│       ├── e2e/                Playwright end-to-end tests
│       └── e2e-compat/         Safari/Firefox compatibility tests
├── packages/
│   ├── engine/                 Python engine: transcript → selected sections → face-tracked
│   │                           reframe → burned-in captions, all via streaming ffmpeg;
│   │                           CLI locally, Modal worker in production (modal_app.py)
│   ├── contracts/              JSON contracts shared by Python and TypeScript
│   │                           (task kinds, AI model catalog, document schemas)
│   ├── clip-doc/               the clip document: zod schema, validation, migrations
│   ├── editor-core/            operations on the document — the only write path
│   │                           (editor buttons, the API and the Assistant all use it)
│   ├── clip-render/            Canvas 2D renderer, shared by the browser preview and the exporter
│   ├── clip-export/            server export: document → MP4
│   ├── clip-motion/            explainer animations (Remotion), rendered on the worker
│   ├── clip-three/             3D scenes, rendered on a GPU worker
│   ├── clip-icons/             animated icon library
│   ├── clip-assets/            the editor media library: manifest, folders, rename/move/delete
│   ├── clip-media/             bundled fonts and Lottie animations
│   ├── editor-parity/          golden-image tests that keep the renderer pixel-stable
│   ├── skills/                 style skills: markdown + frontmatter → a generated index
│   └── mcp-server/             MCP server (Streamable HTTP, stateless) so your own Claude
│                               can drive OpenCMO
├── supabase/
│   ├── migrations/             schema history, applied in order
│   ├── tests/                  pgTAP tests, one per migration
│   ├── schema/current.sql      generated snapshot of the current schema (read-only)
│   └── config.toml             local stack config
├── scripts/                    dev stack (dev.mjs), schema dump, document checks
└── docs/                       design notes, build plans and research reports
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the decisions behind this shape, including the
two hard budgets every change must respect: **peak RAM per job < 2 GB** and **a 45-minute
video → 5 clips in under 3 minutes**.

## Getting started

Requirements: Node 22+, Docker (for the local Supabase stack), the
[Supabase CLI](https://supabase.com/docs/guides/cli), [`uv`](https://docs.astral.sh/uv/),
and FFmpeg/ffprobe.

```bash
npm ci
uv venv --python 3.12 packages/engine/.venv312
uv pip install --python packages/engine/.venv312/bin/python -e 'packages/engine[face,worker,dev]'
cp apps/web/.env.example apps/web/.env.local   # fill in what you need; most keys are optional
npm run dev                                    # web on http://127.0.0.1:3000
```

`npm run dev` checks Docker, starts the local Supabase stack if needed, loads its keys, and
runs Next.js and the worker together. Without the worker, jobs sit in `queued` with no error.

Use Python **3.12**: MediaPipe (face tracking) has no wheel for newer versions, and without it
the engine silently falls back to a centre crop.

Sign-in is Google OAuth. For local sign-in through the UI, create an OAuth client and set
`SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_GOOGLE_SECRET` (see `supabase/config.toml`);
the test suites sign in with a password through the Auth API and need no Google setup.

AI features need three provider keys: Anthropic (agents, moment selection and moderation),
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

OpenCMO is licensed under the **GNU Affero General Public License v3.0 only**
([LICENSE](LICENSE)). If you run a modified version as a network service, the AGPL requires you
to offer its source code to that service's users.

Bundled fonts, icons, emoji and animations keep their own licenses — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The OpenCMO name and logo are trademarks of the OpenCMO project and are not licensed under the
AGPL. Forks must use a different name and logo.
