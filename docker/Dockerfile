# =============================================================================
# © 2026 Arun Gaikwad. All rights reserved.
# Proprietary and Confidential — Unauthorized use prohibited.
#
# Agentic SDLC — Multi-stage Docker build
#   Stage 1: Build React frontend (Vite)
#   Stage 2: Compile Express API server (TypeScript → JS)
#   Stage 3: Production image — API on :3001, static on :3000
# =============================================================================

# ── Stage 1: Frontend build ────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend

# Dependencies first (layer caching)
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .

# Build-time env vars injected as Docker build args
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: Server build ──────────────────────────────────────────────────────
FROM node:20-alpine AS server-builder
WORKDIR /build/server

COPY server/package*.json ./
RUN npm ci

COPY server/ .
RUN npm run build

# ── Stage 3: Production image ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Install production deps for server only
COPY server/package*.json ./
RUN npm ci --omit=dev

# Compiled server JS
COPY --from=server-builder /build/server/dist ./dist

# Built frontend (served statically on port 3000)
COPY --from=frontend-builder /build/frontend/dist ./public

# Static file server for frontend + tini as PID 1 for correct signal forwarding
# and process supervision (H-NEW-03 fix: & backgrounding silently swallowed API crashes)
RUN npm install -g serve && apk add --no-cache tini

COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000 3001

# tini as PID 1 ensures SIGTERM is forwarded and zombie processes are reaped.
# start.sh exits the container if EITHER the API or the static server crashes.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]
