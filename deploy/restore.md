# Restoring from a backup

Backups live in `/srv/buildwith/backups/<UTC timestamp>[-predeploy-<tag>]/`:

| File         | What                                                           |
| ------------ | -------------------------------------------------------------- |
| `db.dump`    | `pg_dump --format=custom` of the `buildwith` database          |
| `media.tar`  | the media folder (uploads), relative to `BUILDWITH_DATA_DIR`   |
| `info`       | when, which git ref and image tag were live, migration version |
| `SHA256SUMS` | checksums of the above                                         |

Restoring replaces **everything** written since the backup was taken. Announce downtime first.

All commands run on the server as the deploy user, from `/srv/buildwith`:

```bash
cd /srv/buildwith
dc() { docker compose --env-file .env.production -f deploy/compose.prod.yml "$@"; }
B=backups/20261201T030000Z        # the backup to restore
cat "$B/info"
(cd "$B" && sha256sum -c SHA256SUMS)
```

## 1. Stop everything that writes

```bash
dc stop web api worker bot
```

Caddy keeps running and answers `502` for pages; `/media` keeps working.

## 2. Database

```bash
# Take one more backup of the current state first, in case you need something from it.
./deploy/backup.sh before-restore

dc exec -T db dropdb   --username=buildwith --force buildwith
dc exec -T db createdb --username=buildwith --owner=buildwith buildwith
dc exec -T db pg_restore --username=buildwith --dbname=buildwith --no-owner --exit-on-error <"$B/db.dump"
```

## 3. Media

Only needed if files were lost; media is content-addressed, so a newer folder is a superset of an older one.

```bash
DATA=$(grep -oP '^BUILDWITH_DATA_DIR=\K.*' .env.production || echo /srv/buildwith/data)
TAG=$(cat .deploy/current_tag)
mv "$DATA/media" "$DATA/media.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$DATA/media"
docker run --rm --user 0 --entrypoint sh -v "$DATA:/d" -v "$PWD/$B:/b:ro" "buildwith-api:$TAG" \
  -c 'tar -C /d -xf /b/media.tar && chown -R 10001:10001 /d/media'
```

## 4. Start again

Pick the version to run:

- **Same version as now** (data loss, disk failure): `TAG=$(cat .deploy/current_tag)`
- **The version from the backup** (a migration went wrong): `TAG=$(grep -oP '^image_tag=\K.*' "$B/info")`.
  Its image must still exist (`docker image ls buildwith-api`); deploy.sh keeps the last three.
  If it doesn't, check out that tag and run `./deploy/deploy.sh` instead of the commands below.

```bash
BUILDWITH_IMAGE_TAG=$TAG dc run --rm migrate      # no-op unless the backup predates the image's migrations
BUILDWITH_IMAGE_TAG=$TAG dc up -d --no-build api worker web caddy   # add "bot" if Telegram is configured
echo "$TAG" > .deploy/current_tag
curl -fsS https://buildwith.uz/healthz && curl -fsS https://buildwith.uz/v1/health
```

When everything works, delete the `media.before-restore-*` folder.

## Restoring on a new server

1. Set up the server as in [README.md](README.md) up to (not including) the first deploy, using the same `.env.production`
   (keep a copy of it in the maintainers' password manager: it is not in the backups).
2. Copy the backup folder to `/srv/buildwith/backups/` (from the offsite copy, if the old server is gone).
3. `DEPLOY_SKIP_PUBLIC_CHECK=1 ./deploy/deploy.sh` once, so images exist and the database is created and migrated.
4. Follow steps 1–4 above, then point DNS at the new server.

## Testing restores

A backup you have never restored is a hope, not a backup. Once a month, restore the latest one into a scratch
database and check it opens:

```bash
dc exec -T db createdb --username=buildwith restore_test
dc exec -T db pg_restore --username=buildwith --dbname=restore_test --no-owner --exit-on-error <"$B/db.dump"
dc exec -T db psql --username=buildwith --dbname=restore_test -c 'select count(*) from users'
dc exec -T db dropdb --username=buildwith restore_test
```
