FROM node:20-alpine AS builder

# Put client sources in /app/client so Vite's ../shared and ../attached_assets resolve
WORKDIR /app/client

COPY client/package.json client/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi \
	&& ln -sf /app/client/node_modules /app/node_modules

COPY client/ ./
COPY shared/ /app/shared/
COPY attached_assets/ /app/attached_assets/
COPY .env.prod /app/.env.prod

# Vite config outputs to ../dist/public => /app/dist/public
RUN npm run build

FROM nginx:1.27-alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/public /usr/share/nginx/html

EXPOSE 80
