# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

ElectroHeat (repo `EnergyUA`, npm package `electro-heat`): a catalog site for electric underfloor heating. It runs on Next.js 16 App Router with Turbopack, React 19, Prisma 6 on PostgreSQL, and Tailwind 4. The UI, the docs in `docs/` and most code comments are in Ukrainian, and new user-facing text should be too. The `@/*` import alias points to `src/*`.

## Commands

```bash
docker compose up -d            # local Postgres 16 (credentials match .env.example)
cp .env.example .env
npx prisma migrate deploy && npm run db:seed

npm run dev                     # next dev
npm run lint                    # eslint (next core-web-vitals + typescript)
npm run build                   # prisma generate && next build
npm run db:migrate              # prisma migrate dev: create a migration after editing prisma/schema.prisma
npm run db:predeploy            # migrate deploy + seed, the same as Railway pre-deploy
```

There is no test suite. CI (`.github/workflows/ci.yml`) only runs `npm ci`, `npm run lint` and `npm run build` with a dummy `DATABASE_URL`, so verify changes with lint and build. The build works without a reachable database only because the root layout exports `dynamic = "force-dynamic"`. Keep that export, or prerendering will query Prisma at build time.

## Architecture

### Public catalog (`src/app`)
- The routes are `/`, `/catalog`, `/catalog/[slug]` and `/product/[slug]`. Every page is server-rendered and queries Prisma directly through the singleton in `src/lib/prisma.ts`.
- **Visibility rule:** catalog listings show a product only if `published: true` and `mergedIntoProductId: null`. Cross-source duplicates are soft-merged into a canonical product, not deleted, and `/product/[slug]` of a merged duplicate redirects to the canonical product. Any new public listing query must apply the same filter.
- **Category tree:** the root is `tepla-pidloga`, created by `prisma/seed.ts`. Imported categories are flat children with the prefixes `et-*` (et-market), `inh-*` (in-heat) and `vs-*` (vsesezon/Prom). The donor-URL → category mapping lives in `scripts/lib/importCategoryMapping.ts`. The product upsert key is `externalSource` + `externalId`.

### Admin (`/ops/[secret]/…`)
- The URL segment must equal `ADMIN_ROUTE_SECRET`, which defaults to `dev` in development only. `ops/[secret]/layout.tsx` returns 404 when the secret doesn't match or admin isn't configured. The `(protected)` route group calls `requireAdminSession`.
- The session is an HMAC-signed cookie (`eh_admin_sess`). It is signed with `ADMIN_SESSION_SECRET`, or with `ADMIN_PASSWORD` when that is unset (`src/lib/adminAuth.ts`).
- There is no middleware. Each `src/app/api/admin/**` route handler checks the cookie itself with `verifyAdminSessionToken`, so new admin API routes must do the same.

### Product images
- Images are stored as `{sha256}.{ext}` under `MEDIA_ROOT` and served by `src/app/api/media/[filename]/route.ts`, which validates the filename and blocks path traversal. `MEDIA_ROOT` defaults to `storage/media`, which is gitignored. On Railway it is the volume at `/data/media`.
- `product_images.url` holds either an external `http(s)` URL (right after an import) or `/api/media/…` (after mirroring). `sourceUrl` keeps the original URL so that `db:repair-images` can download missing files again.
- `scripts/cli/mirror-product-images.ts` downloads external images and rewrites the URLs. Admin uploads go through `src/lib/saveProductImage.ts`.

### Scrape → import pipeline (`scripts/`, run with `tsx`)
- `scripts/parsers/` contains cheerio scrapers for the three donor sites. `scripts/cli/crawl-*.ts` write manifest JSON to `data/scrape/`, and those files are committed. Production imports the `*-DETAIL.json` files and `vsesezon-catalog.json`.
- `import:catalog-trees` (`import-manifest-categories.ts`) upserts products and categories, then reconciles cross-source duplicates by name similarity. At 90% or more it sets `merged_into_product_id`, with priority et_market → in_heat → vsesezon. Between 75% and 90% it only logs a warning.
- `prisma/seed.ts` imports from `scripts/lib`. It runs on every deploy, so it must stay idempotent (upserts only).
- The full parser and importer CLI reference is in `docs/IMPORT-UK.md`.

## Deployment (Railway)

The service deploys from `main` using the config in `railway.json`:
- **build:** `npm ci && npm run build`
- **preDeploy:** `npm run db:predeploy:railway`, which runs migrations and the seed. If `RAILWAY_REBUILD_CATALOG=yes`, it then also wipes the imported catalog and re-imports it from `data/scrape/*.json` (`scripts/railway-catalog-rebuild.sh`).
- **start:** `scripts/railway-entrypoint.sh`. If `MIRROR_PRODUCT_IMAGES=yes`, it mirrors images before starting, then runs `next start`.

The volume is not mounted during pre-deploy, so never write media files there. Mirroring belongs in the start step.

On the current Railway service the deploy section of `railway.json` was not picked up: pre-deploy and the start command didn't run. The same commands are therefore also set directly in the service settings (build, pre-deploy, start, healthcheck). If you change them in `railway.json`, change them in Railway too. The Railway `redeploy` action reuses the old config snapshot, so to apply new settings trigger a fresh deploy with a push or a variable change.

Environment variables:
- `DATABASE_URL`
- `MEDIA_ROOT`: must equal the volume mount path.
- `ADMIN_PASSWORD`, `ADMIN_ROUTE_SECRET`, `ADMIN_SESSION_SECRET`
- `RAILWAY_REBUILD_CATALOG`, `RAILWAY_CATALOG_WIPE_ALL`: one-off flags, turn them off afterwards.
- `MIRROR_PRODUCT_IMAGES`, `MIRROR_IMAGE_*`

Details are in `docs/DEPLOY-RAILWAY.md` and `docs/MEDIA-STORAGE.md`. Update those docs when you change deploy, import or media behavior.
