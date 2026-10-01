# =============================================================================
# B&B Market - OVHcloud VPS deployment runbook
# =============================================================================
# Nothing here runs automatically. Follow the steps in order.
# Replace every `example.com` and `/var/www/bb-market` before starting.
# =============================================================================

## 0. Prerequisites on the VPS

Ubuntu 22.04 LTS or Debian 12. OVHcloud VPS images ship all of these.

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib postgresql-client
node -v          # must be >= 20 (22 LTS recommended, matches the dev machine)
npm -v
sudo -u postgres psql --version
```

If `node -v` is missing, install Node 22 via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

`postgresql-client` is required: the backup job shells out to `pg_dump`
(server/backup.ts). Without it backups fail at runtime.

## 1. System user and directory

```bash
sudo useradd --system --home /var/www/bb-market --shell /usr/sbin/nologin bbmarket
sudo mkdir -p /var/www/bb-market
sudo chown bbmarket:bbmarket /var/www/bb-market
```

## 2. PostgreSQL role and database

```bash
sudo -u postgres psql -c "CREATE ROLE bbmarket LOGIN PASSWORD 'CHANGE_ME_STRONG';"
sudo -u postgres psql -c "CREATE DATABASE bb_market OWNER bbmarket ENCODING 'UTF8';"
```

Use `127.0.0.1`, not `localhost`: on many systems `localhost` resolves to
`::1` first and PostgreSQL often listens on IPv4 only.

## 3. Get the code and install

```bash
sudo -u bbmarket git clone <YOUR_REPO_URL> /var/www/bb-market
cd /var/www/bb-market
sudo -u bbmarket npm ci
```

## 4. Environment file

```bash
sudo -u bbmarket cp .env.example .env.prod
sudo -u bbmarket nano .env.prod
```

Fill in at minimum: `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`,
`VITE_GOOGLE_CLIENT_ID`, `APP_URL`. See the comments in `.env.example`.

```bash
sudo chown bbmarket:bbmarket .env.prod
sudo chmod 600 .env.prod
```

VITE_GOOGLE_CLIENT_ID is inlined into the JS bundle at BUILD time, so it must
be set before step 5.

### Database connection security

`DATABASE_URL` points at the VPS's own managed PostgreSQL, but that does **not**
mean the connection is safe by default — set this explicitly:

```bash
# in .env.prod — TLS on, which is also the built-in default
DATABASE_SSL=true
```

`server/db-target.ts` resolves this once, and the app, `npm run db:migrate`,
`npm run db:baseline`, `npm run set-password` and the load test all reuse that
single decision, so none of them can quietly connect with weaker settings than the
app. `DATABASE_SSL=false` disables TLS and is only appropriate when the database is
reachable over a Unix socket or a private network — never for a public endpoint.

`rejectUnauthorized` is `false`: OVH issues its certificate for the managed-service
hostname rather than the `postgresql://` endpoint, so a strict check would fail
even over an encrypted connection.

Every timestamp column in this schema is `timestamp without time zone`, while the
application reasons entirely in UTC. `server/db.ts` therefore pins
`options: "-c timezone=UTC"` on every pooled connection and parses naive
timestamps as UTC. Do not "simplify" either away: on a server whose timezone is not
UTC, orders are stored with a shifted wall clock and analytics buckets them into
the wrong day near midnight.

## 5. Build

```bash
cd /var/www/bb-market
sudo -u bbmarket npm run build
```

Produces `dist/public` (frontend) and `dist/server` (API).

`npm run build` empties `dist/`, so never store uploaded images there. The
upload directory defaults to `public/uploads`, which is outside `dist/` and
therefore survives a deploy. If you point `UPLOADS_DIR` elsewhere in
`.env.prod`, create that directory and make it writable by the service user:

```bash
sudo install -d -o bbmarket -g bbmarket /var/www/bb-market/public/uploads
```

## 6. Apply migrations to PostgreSQL

```bash
cd /var/www/bb-market
sudo -u bbmarket -E NODE_ENV=production npm run db:migrate
```

`NODE_ENV=production` is REQUIRED here, and it is easy to get wrong: without
it `server/env.ts` looks for `.env` instead of `.env.prod`, finds nothing, and
the migration silently applies to a throwaway SQLite file next to the server
instead of to PostgreSQL. The script prints the target on its first line, so
check that it says `dialect : postgresql` before trusting it.

The script also prints `TLS on` / `TLS OFF`. Expect `TLS on`: the migration runs
with DDL rights against the live database, and TLS is on by default because
`server/db-target.ts` resolves it once for both the app and the migrator. Only set
`DATABASE_SSL=false` for a localhost socket or a private network — see
[Database connection security](#database-connection-security).

```bash
sudo -u postgres psql -d bb_market -c '\dt'
```

Expect 11 tables (six migrations, `0000`–`0005`):

| table | added by |
| --- | --- |
| `products`, `messages`, `users`, `promos`, `sticker_catalogs`, `settings`, `categories`, `orders`, `social_media_embeds`, `user_activities` | `0000_initial_schema` |
| `wishlist` | `0004_wishlist` |

Confirm the journal matches the migrations on disk — a partial apply is the failure
mode worth catching here:

```bash
sudo -u postgres psql -d bb_market -c 'select count(*) from drizzle.__drizzle_migrations'
# expect 6
```

A count of `0` means the migration ran against the throwaway SQLite file instead
(see the warning above). Re-run with `NODE_ENV=production` before investigating.

## 7. Nginx and TLS

```bash
sudo cp deploy/nginx/bb-market.conf /etc/nginx/sites-available/bb-market
sudo nano /etc/nginx/sites-available/bb-market      # domain + paths
sudo ln -s /etc/nginx/sites-available/bb-market /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Certificate AFTER nginx -t passes, so the HTTP block exists for validation.
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

## 8. Service

```bash
sudo cp deploy/systemd/bb-market.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bb-market
systemctl status bb-market
journalctl -u bb-market -f
```

## 9. Create the owner accounts BEFORE the site is public

Do this before the first visitor can reach the site. It is the only way to
create a superadmin on a fresh database, and step 12 explains why.

```bash
cd /var/www/bb-market
sudo -u bbmarket -E NODE_ENV=production \
  SEED_ADMIN_PASSWORD='STRONG_PASS' npx tsx server/seed-admin.ts
```

`NODE_ENV=production` matters here for the same reason as in step 6: without it
the script reads `.env` instead of `.env.prod` and would target the wrong
database.

It creates `BBMarket` (bbmarket26@gmail.com) and `Omar`
(omar.hmida.lgl@gmail.com) as `superadmin`.

The script is **idempotent and safe to re-run**, so you do not have to be sure the
site has never been reached. For each account it matches on **email**, not
username:

- Email not present → the admin is created.
- Email already present → that exact row is promoted to `superadmin` instead of
  creating a second one, and any pending password-reset token is cleared. The
  password is reset on promotion, so a visitor who registered an owner address
  before you got here keeps no usable credentials.
- The desired username already held by a *different* email → that account is left
  completely untouched and a free username (`BBMarket-2`, …) is used instead.
- The two admin emails are the only rows this script ever modifies.
- An account that is already `superadmin` with a healthy password is left alone,
  so a password you changed after the first run is not silently reverted. Pass
  `SEED_ADMIN_UPDATE_EXISTING=1` to force a password reset.

Verify the result:

```bash
sudo -u bbmarket npm run test:auth -w server   # 13 role + 37 provisioning checks
```

To set or reset an existing user's password later (the generated password is
printed to a file in the OS temp dir, never to stdout):

```bash
sudo -u bbmarket -E NODE_ENV=production npm run set-password -w server -- omar@example.com
```

## 10. Verify

```bash
curl -s https://example.com/api/health          # {"status":"ok","database":"postgresql"}
curl -sI https://example.com/products            # must be 200, not 404 (SPA)
curl -sI https://example.com/admin                # must be 200 (SPA)
systemctl is-enabled bb-market                   # -> enabled
```

Then confirm the proxy headers are doing their job. The cookie must be marked
`Secure` and `HttpOnly`; a missing `Secure` here is the symptom of an
`X-Forwarded-Proto` problem:

```bash
curl -si -X POST https://example.com/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"omar","password":"WRONG"}' | grep -i set-cookie
# Wrong password still sets no session cookie, so instead log in for real once
# and inspect the browser: Application -> Cookies -> connect.sid must show
# Secure and HttpOnly.
```

Finally open https://example.com/ in a browser, log in, and reload. A session
that survives the reload is the real proof the proxy headers are correct.

## Updates (subsequent deploys)

```bash
sudo -u bbmarket git pull
cd /var/www/bb-market && sudo -u bbmarket npm ci
sudo -u bbmarket npm run build
sudo -u bbmarket -E NODE_ENV=production npm run db:migrate
sudo systemctl restart bb-market
```

`npm run build` empties `dist/`, which is why uploads live in `public/uploads`.
Do not move them into `dist/`.

Take a database backup first if one has not run recently: `POST /api/admin/backup`.

## 11. Backup check

The daily cron job at midnight needs `pg_dump` on PATH plus Backblaze B2
credentials in `.env.prod`. With any of them missing the job logs and skips, so
confirm it is actually working rather than assuming:

```bash
sudo -u bbmarket -E NODE_ENV=production curl -s -X POST https://example.com/api/admin/backup \
  -H 'Cookie: connect.sid=<a session cookie from a superadmin login>'
```

## 12. Authorisation policy (already enforced, nothing to configure)

Public registration can never produce a privileged account. The policy lives in
`server/roles.ts` and is regression-tested:

```bash
cd /var/www/bb-market && sudo -u bbmarket npm run test:auth -w server
```

Expected: `13 passed, 0 failed`. It migrates throwaway databases in the temp
directory, so it is safe to run on the VPS and touches nothing.

How it behaves:

| Situation | Resulting role |
| --- | --- |
| Any `POST /api/register`, production | `client` |
| `POST /api/register` claiming an owner email, production | `client` |
| `ALLOW_DEV_FIRST_USER_SUPERADMIN=1` in production | ignored, still `client` |
| Development, flag unset, first user | `client` |
| Development, `ALLOW_DEV_FIRST_USER_SUPERADMIN=1`, first user | `superadmin` |

Admins are created only by step 9 (`server/seed-admin.ts`) or by an existing
superadmin through `POST /api/admin/users`.

This closed a real takeover: promotion previously happened in five places,
including a hardcoded list of the two owner email addresses checked on
`POST /api/register` and again on every read in `storage.getUserByEmail`. Since
that endpoint never verified ownership of the submitted address, anyone could
register an owner address with their own password, log in, and receive
`superadmin`.

The flag is read with the production check first, so no value of
`ALLOW_DEV_FIRST_USER_SUPERADMIN` can re-enable the behaviour on the VPS.

`storage.getUserByEmail` and `getUserByUsername` now also normalise a missing
role to `client` rather than `admin`, so a partially inserted row can never be
privileged.

Provisioning was also a lockout risk: the seed script matched accounts by
username only, and because `users.email` is `NOT NULL UNIQUE` a visitor who
registered an owner address before step 9 made the insert abort with
`UNIQUE constraint failed: users.email`, killing the script part-way through and
leaving the owner unable to sign in. `server/seed-admin.ts` now matches by email
first, promotes the existing row in place, and is idempotent; see step 9.
