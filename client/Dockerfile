FROM node:20-alpine AS builder

# Put client sources in /app/client so Vite's ../shared and ../attached_assets resolve
WORKDIR /app/client

# The Google client ID is inlined into the JS bundle by Vite at BUILD time.
# Vite reads env vars from its envDir (the repo root) and from the process
# environment, but NOT from .env.prod, so it is passed in as a build arg and
# exported into the environment before `npm run build`. It is a public value.
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

COPY client/package.json client/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi \
	&& ln -sf /app/client/node_modules /app/node_modules

COPY client/ ./
COPY shared/ /app/shared/
COPY attached_assets/ /app/attached_assets/

# Vite config outputs to ../dist/public => /app/dist/public
RUN npm run build

FROM nginx:1.27-alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/public /usr/share/nginx/html

EXPOSE 80
