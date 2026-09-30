# syntax=docker/dockerfile:1
# Multi-stage build: dependencies -> build -> init -> API + Next runners.
# Base pinned to the Node 22 family (bookworm-slim for glibc: argon2
# prebuilds work without a compiler in the final images). Release digest
# pinning remains a separate step after validating the target registry.
# Both runners are non-root; only the API owns the uploads directory.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_DGIS_MAP_KEY=""
ENV NEXT_PUBLIC_DGIS_MAP_KEY=$NEXT_PUBLIC_DGIS_MAP_KEY
ENV NEXT_PUBLIC_ABAI_MOCK=0
# Must succeed without a live database (cabinet pages render dynamically).
RUN npm run build

FROM node:22-bookworm-slim AS init
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY db ./db
COPY scripts ./scripts
COPY src/server ./src/server
COPY src/contracts ./src/contracts
COPY docs/fixtures ./docs/fixtures
# Runs migrations then the idempotent demo seed (APP_ENV=demo/test only).
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/seed.mjs"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN useradd --system --create-home --home-dir /home/nextjs nextjs \
  && mkdir -p ./public
USER nextjs
COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nextjs /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
RUN useradd --system --create-home --home-dir /home/nextjs nextjs \
  && mkdir -p /app/storage/uploads \
  && chown -R nextjs:nextjs /app/storage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY src/server ./src/server
COPY src/contracts ./src/contracts
COPY scripts/serve.mjs ./scripts/serve.mjs
COPY src/features/assistant ./src/features/assistant
COPY scripts/cleanup-storage.mjs ./scripts/cleanup-storage.mjs
COPY db/migrations ./db/migrations
COPY --from=build /app/dist/routing ./dist/routing
USER nextjs
EXPOSE 18080
CMD ["node", "scripts/serve.mjs"]
