PROJECT_ID  := massivecart-api
REGION      := us-central1
SERVICE     := massivecart-api
REPO        := massivecart
IMAGE       := $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(REPO)/api
TAG         := $(shell git rev-parse --short HEAD 2>/dev/null || echo "latest")

.PHONY: registry build push deploy release up down logs dev db db-stop seed

# ── Local dev ─────────────────────────────────────────────────────────────────

## Containerized API on http://localhost:8000 (starts local Supabase first)
up: .env db
	docker compose up --build -d
	@echo "API running on http://localhost:8000 — 'make logs' to follow, 'make down' to stop"

## Stop the API container and the local Supabase stack
down:
	docker compose down
	supabase stop

## Follow container logs
logs:
	docker compose logs -f

## Hot-reload dev server on http://localhost:8000 (starts local Supabase first)
dev: .env db
	bun install
	bun run dev

## Local Supabase (Postgres + Auth + Realtime on :54321) — idempotent
db:
	supabase start

db-stop:
	supabase stop

## Optional: larger dataset from the cached seed files in data/
seed:
	bun install
	bunx tsx scripts/seed-products.ts
	bunx tsx scripts/seed-synthetic.ts

.env:
	cp .env.example .env
	@echo "Created .env from .env.example — local Supabase works as-is; add API keys for LLM features"

# ── Cloud Run deploy (maintainer's personal setup) ────────────────────────────
# These targets deploy to MY GCP project (Artifact Registry + Cloud Run) and
# read a gitignored env.yaml. They will not work for anyone else as-is —
# deploying your own instance needs your own infra config. The Dockerfile is
# a standard multi-stage node build; any container host can run it.

## First-time setup: create Artifact Registry repo + configure Docker auth
registry:
	gcloud artifacts repositories create $(REPO) \
	  --repository-format=docker \
	  --location=$(REGION) \
	  --project=$(PROJECT_ID) 2>/dev/null || true
	gcloud auth configure-docker $(REGION)-docker.pkg.dev --quiet

## Build image tagged with git SHA + latest
build:
	docker build -t $(IMAGE):$(TAG) -t $(IMAGE):latest .

## Refresh Docker auth (access token, valid ~1hr) then push both tags
push:
	gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin us-central1-docker.pkg.dev
	docker push $(IMAGE):$(TAG)
	docker push $(IMAGE):latest

## Deploy the git-SHA-tagged image to Cloud Run
deploy:
	gcloud run deploy $(SERVICE) \
	  --image $(IMAGE):$(TAG) \
	  --region $(REGION) \
	  --platform managed \
	  --allow-unauthenticated \
	  --port 8080 \
	  --env-vars-file env.yaml \
	  --project $(PROJECT_ID)

## One shot: build → push → deploy
release: build push deploy
