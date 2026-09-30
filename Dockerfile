# syntax=docker/dockerfile:1.7
# Образ Dublyarr: Node (Next.js + воркер) + Python (Laya) + MKVToolNix + ffprobe. Только linux/amd64.

FROM --platform=linux/amd64 node:24-bookworm-slim AS deps
WORKDIR /app
ENV CI=true
RUN corepack enable
# python3/make/g++ — на случай, если готового бинарника better-sqlite3 скачать не удалось
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && pnpm prune --prod

FROM --platform=linux/amd64 node:24-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 mkvtoolnix ffmpeg tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 LAYA_PORT=8765 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/laya ./laya
COPY bin/dublyarr /usr/local/bin/dublyarr
RUN chmod +x /usr/local/bin/dublyarr && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/supervisor.cjs"]
