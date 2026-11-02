# ─────────────────────────────────────────────────────────────
# BlueBeakend — Multi-stage Dockerfile
# Stage 1: Build Next.js 14 Web Admin Dashboard (/admin)
# Stage 2: Production Fastify API + Realtime server (Node 20)
# ─────────────────────────────────────────────────────────────

FROM node:20-alpine AS admin-builder
WORKDIR /build/admin
COPY admin/package*.json ./
RUN npm install --no-audit --no-fund
COPY admin/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

# Install wget for container healthcheck & postgresql-client for backup/restore helpers
RUN apk add --no-cache wget ca-certificates

COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./
COPY --from=admin-builder /build/admin/out ./admin-dist

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV ADMIN_DIST_DIR=/app/admin-dist

EXPOSE 8080 8081

CMD ["node", "src/index.js"]
