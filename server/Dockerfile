# =========================
# 1) Builder
# =========================
# Bookworm (Debian 12) for a reliable apt mirror and a current glibc. The build
# toolchain below compiles better-sqlite3 from source here; the runtime stage is
# a fresh bookworm-slim image, so none of it ships.
FROM node:20-bookworm-slim AS builder

WORKDIR /app/server

# Build toolchain for native modules (better-sqlite3): the slim image has no
# Python/compiler and prebuild-install does not resolve a binary here, so npm
# falls back to node-gyp. These stay in the builder only; the runtime stage is
# a fresh slim image, so they are never shipped.
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package files for explicit server installation
COPY server/package.json server/package-lock.json* ./

# Install deps within server 
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi && \
    ln -sf /app/server/node_modules /app/node_modules

# Copy sources preserving the physical relative paths required by tsconfig
COPY server/ ./
COPY shared/ /app/shared/
COPY attached_assets/ /app/attached_assets/

# Build TS + rewrite aliases (rootDir=".." dumps to dist/server/ and dist/shared/)
RUN npm run build


# =========================
# 2) Runtime
# =========================
FROM node:20-bookworm-slim
WORKDIR /app/server

ENV NODE_ENV=production
EXPOSE 3000

# Debian bookworm ships postgresql-client 15, which matches the postgres:15
# database and provides pg_dump for server/backup.ts. wget is used by the
# compose healthcheck. No external apt repo or deprecated apt-key needed.
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client wget && \
    rm -rf /var/lib/apt/lists/*


# Copy necessary files for runtime
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/server/dist ./dist
# Drizzle migration SQL is read at runtime by scripts/migrate.js (the `migrate`
# compose service) from <server root>/migrations - it is not compiled into dist/.
COPY --from=builder /app/server/migrations ./migrations
COPY --from=builder /app/attached_assets /app/attached_assets

# Run compiled JS (placed in dist/server/index.js). The `migrate` service in
# docker-compose overrides this with: node dist/server/scripts/migrate.js
CMD ["node", "dist/server/index.js"]
