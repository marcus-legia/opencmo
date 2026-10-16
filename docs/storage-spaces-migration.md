# Spec: move file storage to DigitalOcean Spaces

Status: **proposed** (2026-10-16). Not started.

## Why

On 2026-10-16 a 2:18 `.mkv` upload in the editor failed with
`tus: unexpected response while creating upload … response code: 413, Maximum size exceeded`.
The `media` bucket and `MAX_UPLOAD_BYTES` both allow 2 GB, but the Supabase **project-wide**
upload limit wins, and on the Free plan it is fixed at **50 MB** (Pro: up to 500 GB). The editor
showed "Check your connection" because `lib/upload-tus.ts` maps every TUS error to that sentence.

Upgrading Supabase to Pro unblocks uploads today. This spec is about the next step: where video
files should live as the product grows. Video is egress-heavy — the Modal worker downloads
sources, the editor downloads masters and proxies, users download exports — and egress is
where Supabase Storage is expensive.

## Decision

| Role | Choice | Why not the alternative |
|---|---|---|
| Postgres, Auth, RLS, RPCs, `jobs` queue, credits | **Supabase Pro** | DO Managed Postgres has no Auth, no JWT→RLS, no pgTAP setup; nothing to gain. |
| Object storage + CDN (`sources`, `media`, `exports`, `renders`, `clips`, `brand`) | **DigitalOcean Spaces + Spaces CDN** | Supabase Storage egress is 9× the price. Cloudflare R2 was ruled out by Marcus. |
| Worker (ffmpeg, MediaPipe, 3D, Remotion) | **Modal** (unchanged) | DO GPU Droplets bill while powered off; our load is bursty. |
| Web | **Vercel** (unchanged) | DO App Platform is cheaper but weaker for Next.js 16; files don't pass through Next.js anyway. |

Supabase Pro is required regardless (Free pauses idle projects and has no daily backups).

## Price comparison (checked 2026-10-16)

| | Supabase Storage (Pro) | DO Spaces |
|---|---|---|
| Base | included in $25/mo | $5/mo |
| Included | 100 GB stored, 250 GB egress | 250 GiB stored, 1 TiB egress |
| Extra storage | $0.0213/GB | $0.02/GiB |
| Extra egress | **$0.09/GB** (cached $0.03) | **$0.01/GiB** |
| CDN | cached egress tier | Spaces CDN, no extra cost |
| Max object | 500 GB | — (S3 multipart) |

Example month — 200 GB stored, 1 TB egress: Supabase ≈ **$95**, Supabase Pro + Spaces ≈ **$30**.
Retention keeps ~150–300 GB standing at 100 projects/week (`opencmo-internal/COSTS.md` §5), so
storage cost is small either way; egress is what grows.

Compute, for reference: Modal CPU $0.0000131/core-s (a 3-minute 8-core job ≈ $0.02), scales to
zero. DO RTX 4000 GPU Droplet $0.76/h ≈ $550/month always on — only worth it above ~50%
utilisation.

## Known Spaces risks (and what we do about them)

- **Reliability reports**: 503 "Slow Down" below the rate limit, uneven latency, a few
  "use it only for backups" posts (mostly 2017–2020). New buckets allow 800 ops/s.
  → Every Spaces call retries with exponential backoff; the worker already treats storage
  errors as retryable.
- **Browser multipart uploads**: CORS must expose `ETag` (the dashboard form cannot set
  `ExposeHeaders`; set it with the API/s3cmd). A URL signed for the wrong region fails as a
  CORS error. → CORS config lives in a script in the repo, checked in CI.
- **No RLS on objects**: ownership is no longer a Storage policy. → Every presigned URL is issued
  by an API route after an ownership-checking RPC (web rule 1). Object keys keep the
  `<user_id>/…` prefix so a check is one string comparison.

## Target design

**Upload** (replaces TUS): browser → `POST /api/v1/uploads` (reservation RPC, unchanged checks:
bucket, path, size) → route returns an S3 multipart upload id + presigned part URLs → browser
uploads parts directly to Spaces (Uppy `@uppy/aws-s3` or a small client) → `complete` call →
existing register step (`/projects/:id/media`). Resume = list uploaded parts. Files still never
pass through Next.js.

**Download**: presigned GET (short TTL) for private objects; CDN URL with signed token only if
preview playback needs edge caching.

**Worker**: new `backends/s3/storage.py` implementing the same interface as
`backends/supabase/storage.py` (`upload_object`, `download_object`, `sign_object_url`,
`remove_objects`, `copy_object`, …). ffmpeg keeps reading sections over a presigned URL with
`-ss` before `-i` (hard budget 3–4). Spaces region **NYC3** (Modal runs mostly in US-East).

**Retention / cleanup**: Storage-side triggers and `storage.objects` queries become a cron that
deletes by key list (from `media_assets` / job rows) plus Spaces lifecycle rules as a safety net.

## What changes

1. **Web** — `lib/storage.ts`, `lib/upload-tus.ts` (replaced), `app/api/cron/cleanup/route.ts`,
   `lib/editor/device.ts`, `components/editor/library/{store,local}.ts`,
   `components/editor/clipping/ClipsPanel.tsx`, `components/clipping/web/{SettingsView,BrandView,AccountUsage}.tsx`,
   `components/cmo/workspace/NewVideoPack.tsx`, `lib/api/contract.check.ts`.
2. **Engine** — `opencmo/backends/s3/storage.py` + selection by env; Modal secret `opencmo-spaces`
   (`SPACES_KEY`, `SPACES_SECRET`, `SPACES_REGION`, `SPACES_BUCKET_PREFIX`).
3. **SQL** — 14 migrations touch `storage.objects`/`storage.buckets` (init, upload_sources,
   web_rls, worker_d2_publication, web_d3_security_completion, cleanup_bounded_orphan_candidates,
   exports_bucket, client_export, generations, drop_client_export, brand_kits, ai_media_fal,
   free_account_retention, background_removal). New migration: keep reservation RPCs, add a
   `storage_backend` column on object rows during the move, replace usage/cleanup functions that
   read `storage.objects`. Each with a pgTAP test.
4. **CLAUDE.md** — web rule 3 becomes "presigned multipart uploads with a reservation".

## Rollout

1. Supabase Pro + project upload limit 2 GB (unblocks now; independent of this spec).
2. Engine S3 backend + tests against a real Spaces bucket (dev).
3. Web upload/download behind `STORAGE_BACKEND=spaces`; new objects go to Spaces, reads check
   the row's backend.
4. Copy existing objects (most expire in 7 days — simply waiting a week may beat copying).
5. Remove Supabase Storage paths and policies.

Estimate: 1–2 weeks with pgTAP + e2e.

## Open questions

- Does preview playback need the CDN, or is presigned GET from NYC3 fast enough for Asia users?
- Keep `brand` (small, public-ish images) on Supabase to avoid churn?

## Sources

- Supabase file limits — https://supabase.com/docs/guides/storage/uploads/file-limits
- DO Spaces pricing — https://www.digitalocean.com/pricing/spaces-object-storage
- DO Spaces limits — https://docs.digitalocean.com/products/spaces/details/limits/
- DO Droplet/GPU pricing — https://docs.digitalocean.com/products/droplets/details/pricing/
- Spaces presigned uploads — https://blog.jakesaunders.dev/how-to-get-digitalocean-spaces-presigned-uploads-working/
- Uppy multipart to Spaces — https://meta.discourse.org/t/uppy-s3-multipart-direct-upload-to-digitalocean-spaces/228301
- Spaces CORS/region issue — https://www.digitalocean.com/community/questions/spaces-presigned-link-upload-failing-cors-despite-configuration-from-dashboard
- Spaces errors report — https://www.digitalocean.com/community/questions/lots-of-unexplained-errors-with-do-spaces-object-storage
- Modal pricing — https://modal.com/pricing
- Next.js hosting 2026 — https://www.luckymedia.dev/guides/best-nextjs-hosting
