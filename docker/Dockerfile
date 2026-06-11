# ── Stage 1: Build frontend ─────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Backend ─────────────────────────────────────────────
FROM node:20-alpine AS backend
WORKDIR /backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .

# ── Stage 3: Production image ────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy built frontend
COPY --from=frontend-builder /app/dist /app/dist

# Copy backend
COPY --from=backend /backend /backend

# Install 'serve' for static frontend
RUN npm install -g serve

EXPOSE 3000 3001

# Start backend proxy + serve frontend
CMD ["sh", "-c", "node /backend/src/proxy.js & serve -s /app/dist -l 3000"]
