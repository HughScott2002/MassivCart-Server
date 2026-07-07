# Dev Environment Design — MassivCart (API + UI)

Date: 2026-07-06
Owner: Hugh (all requirements from Hugh's request)
Branch: `feat/dev-env` in each repo

## Goals

1. Reproducible dev environment via Nix flake in each repo — anyone with Nix
   can clone and get bun + node + make without installing anything globally.
2. The server (MassivCartAPI) is containerized and runnable locally with one
   command: `make up`.
3. Local dev loop: `bun run dev` (hot reload) in either repo, `make up` for
   the containerized API.
4. One command per repo after clone yields a working dev build.
5. All changes land on a `feat/dev-env` branch in each repo.

## Non-goals

- UI containerization (request was to containerize the server only).
- Production deploy changes — the Cloud Run Makefile targets (`registry`,
  `build`, `push`, `deploy`, `release`) and the production Dockerfile stages
  stay as they are.
- Postgres client wiring. `src/db/postgres-client.ts` is untracked
  work-in-progress; nothing in tracked code imports it. It stays untracked
  and out of scope (and is dockerignored so it cannot break image builds).
- Local redis container. The API uses `@upstash/redis` (REST protocol); a
  plain redis container would not work with that client, and
  `src/lib/cache.ts` already degrades to a no-op cache when Upstash vars are
  absent.

## Local Supabase (added after review with Hugh)

Sign-in is Supabase Auth (email/password + Google OAuth) and all data lives
in Supabase, so a dev environment without it cannot exercise the app. Hugh
chose a fully local stack over shared cloud keys:

- `supabase/config.toml` + `supabase/migrations/20260706000000_init.sql`
  (schema copied from `docker/postgres-init.sql`, which also seeds sample
  stores/products/prices and a test user, plus a realtime publication on
  `prices` for the UI's live subscription).
- The supabase CLI is a system prerequisite, NOT pinned in the flake — Hugh
  manages it via his NixOS config (system 2.105.0 vs 2.60.0 in the pinned
  nixpkgs), and the flake-pinned version kept failing to substitute.
- `make db` / `make db-stop` wrap `supabase start` / `stop`; `make up` and
  `make dev` depend on `db`, so one command still brings up everything.
- `.env.example` defaults to the local stack (URL `http://127.0.0.1:54321`
  plus the deterministic local development keys the CLI prints — these are
  the same on every machine and safe to commit).
- The API container reaches the host's Supabase via
  `host.docker.internal:host-gateway`; compose overrides `SUPABASE_URL`
  accordingly (cloud users set `COMPOSE_SUPABASE_URL` in `.env`).
- `make seed` (optional) loads the larger cached dataset from `data/` via
  the existing seed scripts — no Anthropic key needed thanks to the cached
  JSON files.
- Email/password sign-in works locally out of the box. The Google OAuth
  button requires real OAuth client keys and stays non-functional locally.

## Decisions

### Nix: flake.nix + committed flake.lock (both repos)

- Pinned to the `nixos-25.11` nixpkgs branch; `flake.lock` committed so every
  clone resolves identical toolchain versions.
- devShell packages: `bun`, `nodejs_22` (the `tsx`, `tsc`, and `next` CLI
  binaries are node scripts — bun alone is not enough), and `gnumake` in the
  API repo.
- shellHook runs `bun install` when `node_modules` is missing, and warns when
  `.env` is missing. Idempotent, no-op on subsequent entries.
- `.envrc` with `use flake` for direnv users; harmless without direnv.
  `.direnv/` added to `.gitignore`.
- Rejected: `shell.nix` (channel-dependent, not reproducible across
  machines).

### API: fix compose instead of rewriting the Dockerfile

- The Dockerfile stays npm/node-based for Cloud Run parity. Rewriting it to
  bun changes the production runtime — out of scope.
- `docker-compose.yml` gains `env_file: .env` (it currently forwards only 3
  Supabase vars, so the container crashes on missing required env and lacks
  `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, etc.).
- Port aligned to the server default 8000: container `PORT=8000`, host map
  `${PORT:-8000}:8000`. README updated to match (it currently says 3000).

### API: relax env validation

- `src/config/env.ts` requires `UPSTASH_REDIS_REST_URL`/`_TOKEN` while
  `src/lib/cache.ts` explicitly handles them being absent. The schema makes
  both optional so a fresh clone boots without an Upstash account (cache
  disabled, logged behavior unchanged).

### API: Makefile dev targets

Added alongside the untouched deploy targets:

- `make up` — ensure `.env` exists (copy from `.env.example` with a warning
  if not), then `docker compose up --build`.
- `make down` — `docker compose down`.
- `make logs` — `docker compose logs -f`.
- `make dev` — `bun install` + `bun run dev` (hot reload via tsx watch).

### UI: bun-first, no docker

- Commit the currently-untracked `bun.lock` (reproducible installs are the
  point of "anyone can pull and use it").
- One command: `bun run dev` (nix shellHook has already installed deps on
  shell entry).
- README quickstart switches from pnpm to bun and documents `nix develop`.

### Env file consolidation (API)

- `.env.example` is the single canonical template; the stale `.example.env`
  is no longer referenced by the README. Deleting it needs Hugh's explicit
  confirmation (destructive-action rule), so it is left in place and flagged.
- `.env.example` redis section rewritten to reflect reality: Upstash REST
  vars, optional.

## One-command matrix

| Repo          | Command       | Result                                        |
| ------------- | ------------- | --------------------------------------------- |
| MassivCartAPI | `make up`     | containerized API on :8000, built from source |
| MassivCartAPI | `make dev`    | hot-reload dev server on :8000                |
| MassivCartUI  | `bun run dev` | Next.js dev server on :3000                   |

Both assume `nix develop` (or direnv) for the toolchain, and a filled-in
`.env` for real Supabase/Anthropic/Mapbox functionality.

## Testing

- `nix develop -c bun --version` and `-c node --version` in both repos.
- API: `bun run dev` boots and `GET /health` returns 200 with the existing
  local `.env` (which lacks Upstash vars — proves the relaxed schema).
- API: `make up` builds the image, container starts, `GET /health` on the
  mapped port returns 200, `make down` cleans up.
- UI: `bun run dev` boots, `GET /` on :3000 responds.

## Error handling

- Missing `.env`: `make up` copies `.env.example` and warns; server then
  fails fast with zod's "Missing SUPABASE_URL" message — explicit, actionable.
- Missing node_modules: shellHook installs on shell entry; `make dev` also
  runs `bun install` for non-nix users.
