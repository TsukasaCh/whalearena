# syntax=docker/dockerfile:1

# ─── deps: production node_modules only (compiles better-sqlite3 native addon) ──
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# build toolchain is needed to compile better-sqlite3 from source
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

# ─── build: full deps + Vite production build (dist/) ──────────────────────────
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── runtime: slim image with only prod deps, built assets, and the server ─────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    WHALE_DB=/data/whale.db
WORKDIR /app

# prod node_modules (with the compiled better-sqlite3 — same node/OS as builder)
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./

# run as an unprivileged user; /data holds the SQLite DB (mount a volume here)
RUN useradd --create-home --uid 10001 app \
  && mkdir -p /data \
  && chown -R app:app /data /app
USER app
VOLUME ["/data"]
EXPOSE 8787

# lightweight healthcheck: the server answers the SPA fallback on /
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
