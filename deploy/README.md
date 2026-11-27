# Production deployment

buildwith.uz runs on one server (4 vCPU / 8 GB, in Uzbekistan) with Docker Compose:

```
Caddy :80/:443 ─┬─ /media/*  → files in data/media (read-only)
                ├─ /v1/*     → api:8080 (Go; SSE unbuffered)
                └─ *         → web:3000 (React Router SSR) ──► api
api, worker, bot (only with Telegram) ──► db (Postgres 17, not published)
```

| File                     | Purpose                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `compose.prod.yml`       | the stack: db, migrate (one-shot), api, worker, bot, web, caddy              |
| `Caddyfile`              | TLS via Let's Encrypt; the routes, headers and CSP are in `site.caddy`        |
| `site.caddy`             | security headers and CSP, routing, compression, upload limit                 |
| `Caddyfile.shared`, `compose.shared.yml` | the same behind another reverse proxy ([below](#shared-server-behind-another-proxy)) |
| `deploy.sh`              | build → back up → migrate → restart → health check → roll back on failure    |
| `backup.sh`              | `pg_dump` + media archive into `backups/`, retention, optional offsite rsync |
| `restore.md`             | how to restore a backup                                                      |
| `env.production.example` | every production setting                                                     |

On the server everything lives in `/srv/buildwith`, a git checkout of this repo:

```
/srv/buildwith/
  .env.production     secrets (chmod 600, not in git)
  data/media/         uploads (owned by uid 10001, the API's user)
  backups/            deploy/backup.sh output
  .deploy/            current_tag, previous_tag, history, lock
```

Postgres data and Caddy's certificates are Docker volumes (`buildwith_db`, `buildwith_caddy_data`).

## First-time server setup

Ubuntu 24.04 LTS or Debian 13, as root (or with sudo).

**1. User and SSH.** A `deploy` user that logs in with keys only:

```bash
adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# add maintainers' keys and the CI deploy key (step 9) to /home/deploy/.ssh/authorized_keys
cat >/etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh
```

**2. Base system.** UTC clock, automatic security updates, some swap so a build can't OOM the database:

```bash
timedatectl set-timezone UTC
apt-get update && apt-get install -y unattended-upgrades git curl rsync ufw fail2ban
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >>/etc/fstab
```

**3. Docker** from Docker's own repository (follow <https://docs.docker.com/engine/install/ubuntu/>), then:

```bash
usermod -aG docker deploy   # note: the docker group is root-equivalent; guard this account
cat >/etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" }, "live-restore": true }
EOF
systemctl restart docker
```

**4. Firewall.** Only SSH and the web ports. Postgres isn't published, so Docker's bypass of ufw doesn't expose it.

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable
```

GitHub Actions deploys over SSH from changing IP ranges, so port 22 stays open to the world: keys only, fail2ban on.

**5. Checkout.**

```bash
install -d -o deploy -g deploy /srv/buildwith
sudo -iu deploy git clone https://github.com/buildwithuz/buildwith.git /srv/buildwith
install -d -o 10001 -g 10001 /srv/buildwith/data/media   # deploy.sh also fixes this if needed
```

**6. Settings.** As `deploy`:

```bash
cd /srv/buildwith
cp deploy/env.production.example .env.production && chmod 600 .env.production
openssl rand -hex 32   # for POSTGRES_PASSWORD
$EDITOR .env.production
```

Keep a copy of `.env.production` in the maintainers' password manager. It is not part of the backups.

OAuth apps: GitHub callback `https://buildwith.uz/v1/auth/github/callback`, Google redirect URI
`https://buildwith.uz/v1/auth/google/callback`. Telegram login: `/setdomain` in @BotFather to `buildwith.uz`.

**7. DNS.** At the registrar for `buildwith.uz`:

| Name       | Type | Value                                                               |
| ---------- | ---- | ------------------------------------------------------------------- |
| `@`        | A    | server IPv4                                                         |
| `www`      | A    | server IPv4                                                         |
| `@`, `www` | AAAA | server IPv6 (only if the server has one and port 443 works over it) |
| `@`        | CAA  | `0 issue "letsencrypt.org"` (optional)                              |

Caddy gets certificates from Let's Encrypt on first start, so DNS must point here before the public health check can pass.

**8. First deploy.** As `deploy`:

```bash
cd /srv/buildwith
git fetch --tags && git checkout --detach v0.1.0    # the release to run
./deploy/deploy.sh
# DNS not live yet? Check only inside the containers:
DEPLOY_SKIP_PUBLIC_CHECK=1 ./deploy/deploy.sh
```

Then sign in with GitHub, and make yourself a moderator:

```bash
docker compose --env-file .env.production -f deploy/compose.prod.yml exec db \
  psql -U buildwith -c "update users set is_moderator = true where username = 'you'"
```

**9. Deploys from GitHub.** In the repo settings → Environments → `production`: required reviewers = maintainers,
deployment branches/tags = tags `v*`. Add these environment secrets:

| Secret                    | Value                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEPLOY_HOST`             | server IP or hostname                                                                                                                                        |
| `DEPLOY_USER`             | `deploy`                                                                                                                                                     |
| `DEPLOY_SSH_KEY`          | private half of a key made only for CI: `ssh-keygen -t ed25519 -N "" -C github-deploy -f deploy_key`; put `deploy_key.pub` in `~deploy/.ssh/authorized_keys` |
| `DEPLOY_HOST_FINGERPRINT` | on the server: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub \| cut -d' ' -f2` (the `SHA256:…` value)                                                    |

From then on, publishing a release (release-please) or running the Deploy workflow by hand with a tag deploys it
after a maintainer approves.

**10. Backups on a timer.** As root:

```ini
# /etc/systemd/system/buildwith-backup.service
[Unit]
Description=buildwith.uz backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=deploy
WorkingDirectory=/srv/buildwith
ExecStart=/srv/buildwith/deploy/backup.sh
```

```ini
# /etc/systemd/system/buildwith-backup.timer
[Unit]
Description=Daily buildwith.uz backup

[Timer]
OnCalendar=*-*-* 22:30:00 UTC
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl daemon-reload && systemctl enable --now buildwith-backup.timer
systemctl start buildwith-backup.service && journalctl -u buildwith-backup -n 20   # try it once
```

22:30 UTC is 03:30 in Tashkent. Cron instead: `30 22 * * * cd /srv/buildwith && deploy/backup.sh >>backups/backup.log 2>&1`
in `deploy`'s crontab.

For an offsite copy, set `BUILDWITH_BACKUP_RSYNC_TARGET` (and `BUILDWITH_BACKUP_RSYNC_SSH` for a dedicated key) in
`.env.production`. Keep the copy in Uzbekistan too: the backups contain personal data.

## Shared server behind another proxy

Until the Uzbekistan server exists, buildwith.uz can run on a server that already hosts other apps behind a
reverse proxy (nginx, Traefik, another Caddy) that owns ports 80/443. Set in `.env.production`:

```bash
BUILDWITH_EDGE_NETWORK=buildwith-edge
```

`deploy/lib.sh` then adds `compose.shared.yml`: Caddy publishes no ports, serves plain HTTP from
`Caddyfile.shared` (same routes and headers, from `site.caddy`), joins the `buildwith-edge` Docker network as
`buildwith-caddy`, and the stack gets smaller memory limits (~2.5 GB in total, Postgres `shared_buffers=256MB`).
`deploy.sh` creates the network if it is missing.

In the front proxy: TLS for `buildwith.uz` and `www.buildwith.uz`, `www` → `https://buildwith.uz` redirect, and
everything else to `http://buildwith-caddy:80` with `Host`, `X-Forwarded-For` (append) and
`X-Forwarded-Proto: https`, a body limit of at least 13 MB, and buffering off with a long read timeout (SSE).
Caddy trusts `X-Forwarded-For` only from private addresses and reads it from the right.

The checkout can live anywhere (e.g. `~/buildwith`, all paths follow it); set the repository variable `DEPLOY_PATH`
for the Deploy workflow. If the server has little free memory, build on a bigger machine and load the images:

```bash
tag=$(git rev-parse --short=12 HEAD)          # on the same commit as the server checkout
BUILDWITH_IMAGE_TAG=$tag docker compose -f deploy/compose.prod.yml build api web
docker save buildwith-api:$tag buildwith-web:$tag | gzip | ssh deploy@server 'gunzip | docker load'
ssh deploy@server "cd ~/buildwith && DEPLOY_SKIP_BUILD=1 ./deploy/deploy.sh"
```

Personal data of Uzbek users has to be stored in Uzbekistan, so treat a server abroad as temporary: move to a
local one with a backup and restore ([restore.md](restore.md)) before the public launch.

## Day-2 operations

Put this in `~deploy/.bashrc`; the commands below use it:

```bash
dc() { docker compose --env-file /srv/buildwith/.env.production -f /srv/buildwith/deploy/compose.prod.yml "$@"; }
```

**Status and logs**

```bash
dc ps                                # health of every service
dc logs -f --since 10m api worker    # JSON logs; | jq for reading
dc logs caddy | tail                 # access log
cat /srv/buildwith/.deploy/history   # what was deployed when
dc run --rm migrate status           # applied migrations
dc exec db psql -U buildwith         # SQL shell
docker stats --no-stream             # CPU / memory against the limits
```

Container logs rotate at 5 × 20 MB per service.

**Deploying** is `./deploy/deploy.sh` on a checked-out tag (what the workflow does). It refuses to run with local
changes to tracked files, takes a `predeploy-<tag>` backup, and if the new version isn't healthy within 60 s it
switches back to the previous images and exits non-zero. Migrations are not reverted, so write them to be compatible
with the previous release (expand, then contract in a later release).

**Rolling back** to an earlier release: run the Deploy workflow with that tag (rebuilds it), or for an instant switch
to the previous images, which deploy.sh keeps for the last three releases:

```bash
cd /srv/buildwith
PREV=$(cat .deploy/previous_tag)
git checkout --detach "$PREV"
BUILDWITH_IMAGE_TAG=$PREV dc up -d --no-build api worker web caddy   # add bot if Telegram is on
echo "$PREV" > .deploy/current_tag
```

If the bad release ran a migration the old code can't handle, restore its `predeploy-<tag>` backup: see [restore.md](restore.md).

**Backups**: `deploy/backup.sh` any time; `deploy/backup.sh <label>` for one that is kept separately
(newest 5 labelled, newest 14 scheduled). Test a restore monthly ([restore.md](restore.md#testing-restores)).

**Telegram bot**: one bot does everything — Telegram sign-in, notifications, the channel autopost and
**support** (buildwith.uz has no email). Set `BUILDWITH_TELEGRAM_BOT_TOKEN` and `BUILDWITH_TELEGRAM_BOT_USERNAME`
and redeploy; the bot starts only when a token is set. Removing the token and redeploying stops it.

Support inbox, once:

1. Create a private Telegram group for the maintainers and add the bot to it (no admin rights needed).
2. In @BotFather: `/setjoingroups` → keep it enabled until the bot is in the group, then disable it so nobody
   else can add the bot to other groups.
3. With the bot running, send `/id` in the group; the bot answers with the group id (a negative number).
4. Set `BUILDWITH_TELEGRAM_SUPPORT_CHAT=<that id>` in `.env.production` and `dc up -d bot`.

People write to the bot; each message appears in the group under a line saying who sent it. **Reply** to it
(Telegram's reply, not a new message) and the bot delivers your reply to them; 👍 on your message means
it was delivered. Messages in the group that aren't replies stay in the group. `/help` in the group shows this.

For the login widget, set the bot's domain in @BotFather (`/setdomain` → `buildwith.uz`).

**Rotating secrets.** Edit `.env.production`, then recreate the services that read it:

| Secret                         | Steps                                                                                                      | Effect                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| OAuth client secrets           | rotate at GitHub/Google, edit, `dc up -d api`                                                              | none                    |
| `BUILDWITH_TELEGRAM_BOT_TOKEN` | `/revoke` in @BotFather, edit, `dc up -d api worker bot`                                                   | none                    |
| SMTP password                  | edit, `dc up -d api worker`                                                                                | none                    |
| `POSTGRES_PASSWORD`            | `dc exec db psql -U buildwith -c "alter user buildwith password '<new>'"`, edit, `dc up -d api worker bot` | a few seconds of errors |
| CI deploy key                  | new key pair, swap it in `authorized_keys` and the `DEPLOY_SSH_KEY` secret                                 | none                    |

The Postgres container reads `POSTGRES_PASSWORD` only when it creates an empty database, so changing it in the file
alone does nothing; use `alter user`.

**Disk.** `docker system df`; `docker builder prune --filter until=168h` frees old build cache. Daily backups are full
copies of the media folder: watch `du -sh backups` as uploads grow and lower `BUILDWITH_BACKUP_KEEP` or move to
incremental offsite copies when needed.

**Postgres major upgrades** (17 → 18) need a dump and restore: back up, stop writers, start a new volume with the new
image, restore the dump as in [restore.md](restore.md), then switch the image in `compose.prod.yml` in a PR.

**Certificates** renew automatically. They live in the `buildwith_caddy_data` volume; don't delete it, or Let's Encrypt
rate limits can bite when reissuing.

Sessions are random tokens stored in the database, so there is no signing secret to rotate. To sign everyone out:
`dc exec db psql -U buildwith -c 'delete from sessions'`.
