# AGENTS.md — SRED Monorepo

## Project Overview

SRED (Emballages et Décors) — a French e-commerce showcase for packaging, decorations, and gift products. The UI supports French (default) and Arabic (RTL).

## Architecture

- **Monorepo** using npm workspaces: `client/`, `server/`, `shared/`
- **Client**: React 18 + Vite + Tailwind CSS + Radix UI + wouter (routing) + react-i18next
- **Server**: Express + Passport.js (local auth) + Drizzle ORM + node-cron
- **Shared**: Zod schemas, TypeScript types, Drizzle table definitions (dual PostgreSQL/SQLite)
- **Database**: PostgreSQL in production, SQLite in local dev (auto-detected from `DATABASE_URL`)

## Key Commands

```bash
# Development (runs client + server concurrently)
npm run dev

# Server only (port 3000)
npm run server:dev

# Client only (port 5173, proxies /api to :3000)
npm run client:dev

# Build for production
npm run build

# Push schema changes to database (server)
npm run db:push
```

## Environment

- `.env` — local dev (SQLite via `DATABASE_URL=file:./sred_showcase.db`)
- `.env.prod` — production (PostgreSQL) — **not in repo**, lives on VPS only
- `env.ts` loads `.env` for dev, `.env.prod` when `NODE_ENV=production`
- Required vars for production: `DATABASE_URL`, `DATABASE_SSL`, `SESSION_SECRET`, `SMTP_USER`, `SMTP_PASS`, `CLOUDINARY_*`, `B2_*`
- `DATABASE_SSL` is TLS-on by default (`rejectUnauthorized: false`); set `DATABASE_SSL=false` only for a socket/private-network database. `server/db-target.ts` resolves it once and the app, `db:migrate`, `db:baseline`, `set-password`, `test:load` and `pg_dump` (via `PGSSLMODE`) all share that decision — never hardcode `ssl: false` in a new connection.
- Timestamp columns are all `timestamp without time zone` but the app reasons in UTC: `server/db.ts` pins `options: "-c timezone=UTC"` and parses PG OID 1114 as UTC. Don't remove either.
- `.env` is gitignored — safe to customize locally

## Database

- Schema lives in `shared/db-schema.ts` — **dual definitions** (`pgSchema` + `sqliteSchema`)
- Never edit only one; both must stay in sync
- Drizzle config: `server/drizzle.config.ts` (auto-detects dialect from URL)
- Tables: `products`, `messages`, `users`, `promos`, `sticker_catalogs`, `settings`
- Migrations output to `server/migrations/` (run via `drizzle-kit push`)

## Auth & Roles

- Passport.js local strategy with scrypt password hashing (`auth.ts`)
- Login accepts username OR email
- Roles: `superadmin`, `admin`
- First registered user auto-becomes `superadmin`
- Public registration is disabled after first user
- The user `Mohamed` is hardcoded as undeletable (see `routes.ts` line 521)

## API Routes

All prefixed with `/api/`. Auth routes: `/api/login`, `/api/logout`, `/api/register`, `/api/user`.
Admin routes (`superadmin` only): `/api/admin/users`, `/api/admin/backup`.
Product/Promo/Sticker CRUD: `POST/GET/PATCH/DELETE` on `/api/products`, `/api/promos`, `/api/stickers`.

## File Uploads

Images uploaded via Multer (memory storage) then pushed to Cloudinary. Do not store files locally — always use `uploadImage()` from `server/cloudinary_util.ts`.

## Backups

Daily at midnight via `node-cron`. Requires `pg_dump` in PATH and Backblaze B2 credentials (`B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_REGION`). Manual trigger: `POST /api/admin/backup`.

## Client Conventions

- Path aliases: `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`
- Routing via `wouter` (not react-router)
- Data fetching: `@tanstack/react-query` with hooks in `client/src/hooks/`
- Translation keys in `client/src/lib/i18n/` — add new strings to all locale files
- PWA enabled via `vite-plugin-pwa` (auto-update)

## Gotchas

- `npm run build` compiles server with `tsc` + `tsc-alias`, then builds client with Vite → output goes to `dist/`
- Server build uses `tsc-alias` to resolve `shared/*` imports — do not skip it
- SQLite path is resolved relative to `server/db.ts` via `__dirname`, not `process.cwd()` — changing CWD won't break it
- Static assets served from `attached_assets/` with multiple fallback paths for dev/production/Docker
- The `shared/` package has no build step — it's imported directly as source
