# Deploying INTRANET ZERO

## Local (Docker Compose)

```bash
cp .env.example .env           # set SESSION_SECRET
docker build -f infra/Dockerfile -t iz-app .
docker compose -f infra/docker-compose.yml --project-directory . up
```

Note: `docker compose` v5.2 on Windows fails to resolve build contexts when the
repo path contains a space (see DECISIONS D17) — `docker build` is unaffected,
and `infra/compose.prebuilt.yml` runs compose against the prebuilt image.

- The API listens on :8080; `/readyz` gates readiness (database, migrations, bundles).
- Migrations run at boot AND as a pre-deploy step (`apps/server/src/migrate-cli.js`).

## Render (master prompt §17.3)

`infra/render.yaml` is a Blueprint: one Docker web service (plan `0.5c-512mb`,
health check `/readyz`, migrations as `preDeployCommand`, Dockerfile explicitly
`./infra/Dockerfile` because it is not at the repo root) plus a Postgres 18
database (plan `0.1c-256mb`). Free tiers are intentionally not used: free web
services spin down after 15 idle minutes and free Postgres expires after 30 days.

1. Push the repo to GitHub (the Blueprint connects to the repo).
2. In Render: **New → Blueprint**, pick the repo, set the `SESSION_SECRET`
   secret (32+ random bytes), apply.
3. Put Cloudflare in front for TLS/caching if desired; point PUBLIC_ORIGIN at
   the public URL.

Deployment shape and safety notes (2026-11-09):

- **One process/replica only.** WS team rooms, team locks, rate-limit buckets
  and MCP counters are process-local. Scaling beyond one instance (or a rolling
  deploy overlapping two live instances) splits the live event fan-out and is
  NOT supported until those are shared across processes.
- `TRUST_PROXY=1` is set in the blueprint: requests arrive through Render's
  proxy, so rate limiting keys on the proxy-added (rightmost) X-Forwarded-For
  entry. Do not enable it for directly exposed servers, and revisit the policy
  if you add a second proxy hop.
- `NODE_ENV=production` is set: the server refuses to boot unless PUBLIC_ORIGIN
  is https://, and `/readyz` reports 503 until the database, migrations and
  bundles are actually ready.

Troubleshooting: deploy failures usually mean `SESSION_SECRET` was not set
(sync: false) or the world bundle was not baked (`pnpm run worlds:build` runs
inside the Docker build).

## Environment

See `.env.example` for every variable with comments. Required: DATABASE_URL,
SESSION_SECRET, PUBLIC_ORIGIN, WORLDS_DIR. Optional: ASSET_STORE (s3/R2 for
production assets), GITHUB_OAUTH_ID/SECRET (GitHub sign-in), AGENT_* (reference
agent), LOG_LEVEL.
