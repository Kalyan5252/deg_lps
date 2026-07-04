# Backend on a droplet + Jenkins CI/CD

```
 Vercel (frontend) ──HTTPS──▶ Caddy (:443, auto Let's Encrypt) ──▶ FastAPI (:8080, Docker)
                                     on one DO droplet                     │
                              Jenkins (:8080 UI) builds+deploys            └─TLS─▶ DO Managed Postgres
                                                                                  └─▶ Ollama Cloud (AI)
```

- **Backend** → Docker container on a droplet, behind **Caddy** (automatic HTTPS).
- **HTTPS host** → `<droplet-ip>.nip.io` (no domain purchase; real Let's Encrypt cert).
- **CI/CD** → **Jenkins** on the same droplet: on git push it runs unit tests, rebuilds the image, redeploys, and health-checks.
- **DB** → your DO managed `sqlforge` cluster. **AI** → Ollama Cloud.

Repo files: `docker-compose.prod.yml`, `Jenkinsfile`, `infra/droplet/{setup.sh,Caddyfile,api.env.example,deploy.env.example}`.

---

## 1. Create the droplet
- Ubuntu 24.04, **region BLR1** (same as the managed DB → private VPC access), ≥ 2 GB (an existing 8 GB box is great).
- Add your SSH key.
- In the DB cluster → **Trusted Sources** → add this droplet.

## 2. Bootstrap it
SSH in as root and run the installer (Docker + Jenkins + firewall):
```bash
ssh root@DROPLET_IP
git clone https://github.com/Kalyan5252/deg_lps.git /opt/deg && cd /opt/deg
bash infra/droplet/setup.sh
```
It prints the **Jenkins initial admin password** and opens `http://DROPLET_IP:8080`.

## 3. Put secrets on the droplet (never in git)
```bash
cp /opt/deg/infra/droplet/api.env.example /etc/deg/api.env
nano /etc/deg/api.env       # DATABASE_URL (private host, sslmode=require), JWT_SECRET,
                            # CORS_ORIGINS, AI_BASE_URL, AI_MODEL, LIGHTNING_API_KEY
chmod 600 /etc/deg/api.env

cat /etc/deg/deploy.env      # setup.sh auto-set API_DOMAIN=<ip>.nip.io — verify it
```
Generate the JWT secret with `openssl rand -hex 32`.

## 4. Configure Jenkins (browser → `http://DROPLET_IP:8080`)
1. Unlock with the initial password, install **suggested plugins**, create an admin user.
2. **New Item → Pipeline** (name `deg-api`).
3. Under **Pipeline**: *Definition* = **Pipeline script from SCM** → Git →
   `https://github.com/Kalyan5252/deg_lps.git`, branch `*/master`, *Script Path* = `Jenkinsfile`.
4. **Build Triggers:** either **GitHub hook trigger** (add a webhook in GitHub →
   `http://DROPLET_IP:8080/github-webhook/`) or **Poll SCM** `H/2 * * * *`.
5. **Build Now** → it runs: unit tests → `docker compose up -d --build` → smoke-test `https://<ip>.nip.io/api/health`.

## 5. Verify
```bash
curl https://DROPLET_IP-with-dashes.nip.io/api/health
# {"ok":true,"db":{"ok":true,...,"sslmode":"require"}}
```
(First request may take ~15–30 s while Caddy issues the TLS cert.)

## 6. Point the frontend at it
In Vercel → `NEXT_PUBLIC_API_BASE = https://<ip>.nip.io/api`, redeploy.
Then set `CORS_ORIGINS` in `/etc/deg/api.env` to your Vercel URL and re-run the Jenkins job.

---

## Day-to-day
- **Deploy = git push to `master`** → Jenkins rebuilds & redeploys automatically.
- **Manual deploy** (no Jenkins):
  ```bash
  cd /opt/deg && git pull
  set -a; . /etc/deg/deploy.env; set +a
  docker compose -f docker-compose.prod.yml up -d --build
  ```
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api`
- **Restart:** `docker compose -f docker-compose.prod.yml restart api`

## Gotchas
- **nip.io + Let's Encrypt:** works via the HTTP-01 challenge (ports 80/443 must be open — the firewall step handles it). If cert issuance is flaky, retry; or swap `API_DOMAIN` for a real domain later (just edit `/etc/deg/deploy.env` and redeploy).
- **Trusted Sources / private host:** the droplet must be added to the DB's Trusted Sources, and use the DB's **VPC/private** host for lowest latency.
- **Secrets** stay in `/etc/deg/*.env` (git-ignored by living outside the repo). Rotate the DB password since it was shared earlier.
- **Jenkins UI on :8080** is public — lock it down (strong admin password; optionally restrict port 8080 to your IP in the firewall).
