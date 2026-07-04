# Production deployment

Topology:

```
 Vercel (Next.js frontend)  ──HTTPS/JSON──▶  DO App Platform (FastAPI backend)  ──TLS──▶  DO Managed Postgres
   *.vercel.app                                *.ondigitalocean.app                         (already provisioned)
                                                     │
                                                     └──▶ Ollama Cloud (AI, OpenAI-compatible)
```

- **Frontend** → Vercel
- **Backend** → DigitalOcean App Platform (Docker, `backend/Dockerfile`)
- **Postgres** → DO Managed cluster (already running) — connect with `sslmode=require`
- **AI** → Ollama Cloud (`https://ollama.com/v1`) with your API key as a Bearer token

> There is **no local Ollama daemon in production**, so `AI_BASE_URL` must point at
> Ollama's cloud endpoint directly (not `localhost:11434`). If the AI call fails,
> the app degrades to its built-in rule-based mentor — it stays functional.

---

## 0. Prerequisites
- Repo pushed to GitHub (App Platform + Vercel deploy from git).
- DO Managed Postgres connection string. Create the app DB once:
  ```bash
  psql "postgresql://doadmin:PASS@db-host:25060/defaultdb?sslmode=require" -c "CREATE DATABASE sqlforge;"
  ```
  (Or reuse an existing DB name — just match it in `DATABASE_URL`.)
- A long random `JWT_SECRET`:  `openssl rand -hex 32`
- Your Ollama Cloud API key.

---

## 1. Backend → DigitalOcean App Platform

### Option A — Dashboard (simplest)
1. **Create App → GitHub →** pick this repo, branch `master`.
2. When it detects resources, edit the service:
   - **Source Directory:** `backend`
   - **Build:** Dockerfile (auto-detected: `backend/Dockerfile`)
   - **HTTP Port:** `8080`
   - **Health check path:** `/api/health`
3. **Environment variables** (mark secrets as *Encrypted*):
   | Key | Value | Secret |
   |---|---|---|
   | `DATABASE_URL` | `postgresql://doadmin:PASS@db-host:25060/sqlforge` | ✅ |
   | `DB_SSLMODE` | `require` | |
   | `DB_POOL_MAX` | `5` | |
   | `JWT_SECRET` | *(openssl rand -hex 32)* | ✅ |
   | `CORS_ORIGINS` | `https://<your-app>.vercel.app` | |
   | `CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app` | |
   | `AI_BASE_URL` | `https://ollama.com/v1` | |
   | `AI_MODEL` | `gemma4:31b-cloud` | |
   | `LIGHTNING_API_KEY` | *(Ollama Cloud key)* | ✅ |
4. Pick the region **matching your managed Postgres cluster**, size `basic-xs` (1 GB), deploy.
5. Under the DB cluster's **Trusted Sources**, add this App so it can connect.
6. Copy the app's public URL, e.g. `https://deg-api-xxxxx.ondigitalocean.app`.

### Option B — CLI (`.do/app.yaml`)
Edit `.do/app.yaml` (set `github.repo`, `region`, `CORS_ORIGINS`), then:
```bash
doctl apps create --spec .do/app.yaml
# set the SECRET-typed envs (DATABASE_URL, JWT_SECRET, LIGHTNING_API_KEY) in the dashboard
```

### Verify
```bash
curl https://deg-api-xxxxx.ondigitalocean.app/api/health
# {"ok":true,"ai_enabled":true,"db":{"ok":true,"host":"...","latency_ms":..,"sslmode":"require"}}
```
First boot bootstraps the `app` schema and seeds scenarios (a few seconds).

---

## 2. Frontend → Vercel
1. **Add New Project → Import** this repo.
2. **Root Directory:** `frontend`  (framework auto-detected as Next.js).
3. **Environment Variable:**
   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_BASE` | `https://deg-api-xxxxx.ondigitalocean.app/api` |
4. Deploy. Note the production URL, e.g. `https://deg.vercel.app`.

> `NEXT_PUBLIC_*` is inlined at **build time** — after changing it, redeploy.

---

## 3. Close the loop (CORS)
Set the backend's `CORS_ORIGINS` to the **exact** Vercel production URL from step 2
and redeploy the backend. `CORS_ORIGIN_REGEX=https://.*\.vercel\.app` already
covers preview deployments.

---

## 4. Smoke test
1. Open the Vercel URL → sign in with any email.
2. DevTools → Network: API calls hit `…ondigitalocean.app/api`, return 200 (no CORS errors).
3. Open a scenario, run a query; open the pipeline builder, run a pipeline.

---

## Notes & gotchas
- **DB connections:** managed clusters cap connections (~22 on basic). Keep
  `DB_POOL_MAX=5` per instance; if you scale to N instances, N×5 must stay under the cap.
- **Redeploys re-seed scenarios** on boot (idempotent). The health check has a
  60 s grace period for this.
- **Secrets** live only in the DO/Vercel dashboards — never commit real values.
  `backend/.env` stays git-ignored.
- **Custom domain later:** add it in Vercel + DO, then update `CORS_ORIGINS` and
  `NEXT_PUBLIC_API_BASE` and redeploy both.
- **AI model name:** `gemma4:31b-cloud` is what you use locally via the Ollama
  daemon. If the direct cloud endpoint rejects it, use the plain cloud model name
  from your Ollama account; the app falls back gracefully meanwhile.
