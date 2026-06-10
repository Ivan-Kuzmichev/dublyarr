# ---- build: полные зависимости + next build ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN npm ci
COPY . .
RUN npm run build -w @dublyarr/web

# ---- runtime: только прод-зависимости ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/apps/web/.next apps/web/.next
COPY apps/web/next.config.mjs apps/web/
COPY apps/worker/src apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/
COPY packages/core/src packages/core/src
COPY docker/supervisor.mjs docker/supervisor.mjs
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "docker/supervisor.mjs"]
