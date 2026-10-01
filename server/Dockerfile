# =========================
# 1) Builder
# =========================
FROM node:20-bullseye-slim AS builder

WORKDIR /app/server

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
FROM node:20-bullseye-slim
WORKDIR /app/server

ENV NODE_ENV=production
EXPOSE 3000

# Install postgresql-client-15 from official PG repo to match DB version
RUN apt-get update && apt-get install -y wget gnupg lsb-release && \
    sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' && \
    wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - && \
    apt-get update && apt-get install -y postgresql-client-15 && \
    rm -rf /var/lib/apt/lists/*


# Copy necessary files for runtime
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/attached_assets /app/attached_assets

# Run compiled JS (placed in dist/server/index.js)
CMD ["node", "dist/server/index.js"]
