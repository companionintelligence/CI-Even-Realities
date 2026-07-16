# Dockerfile
#
# Packages agent-hub as a self-contained image for CI-Hub marketplace installs
# ("Companion Glasses Bridge"). Two stages: `tsc` compiles src/ → dist/ so the
# runtime image ships plain JS with production deps only (`jose`) — no tsx.
#
#   docker build -t ghcr.io/companionintelligence/ci-glasses-bridge:0.1.0 .
#   docker run -p 8787:8787 ghcr.io/companionintelligence/ci-glasses-bridge:0.1.0

# ── Build stage: compile TypeScript to dist/ ─────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build

# ── Runtime stage: production deps + compiled JS only ────────────────────────
FROM node:22-alpine
WORKDIR /app

# Containers must bind beyond loopback to be reachable from the app network;
# auth still applies (HUB_TOKEN and/or PORTAL_OIDC_ENABLED — see README).
ENV NODE_ENV=production \
    HUB_PORT=8787 \
    HUB_BIND=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

EXPOSE 8787
USER node

# BusyBox wget ships with alpine; /healthz is the hub's liveness route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${HUB_PORT:-8787}/healthz" || exit 1

CMD ["node", "dist/server.js"]
