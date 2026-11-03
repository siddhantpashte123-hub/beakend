# ─────────────────────────────────────────────────────────────
# BlueBeakend — Multi-stage Dockerfile
# Stage 1: Build Next.js 14 Web Admin Dashboard (/admin)
# Stage 2: Production runtime for API (:8080), Realtime (:8081),
#          and S3-Compatible Object Storage (:9000, ROLE=minio)
# ─────────────────────────────────────────────────────────────

FROM node:20-alpine AS admin-builder
RUN apk add --no-cache libc6-compat
WORKDIR /build/admin
ENV NEXT_TELEMETRY_DISABLED=1
COPY admin/package*.json ./
RUN npm install --no-audit --no-fund
COPY admin/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

# Install wget & ca-certificates for container healthchecks and TLS
RUN apk add --no-cache wget ca-certificates

COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./
COPY --from=admin-builder /build/admin/out ./admin-dist

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV ADMIN_DIST_DIR=/app/admin-dist

EXPOSE 8080 8081 9000

CMD ["node", "src/index.js"]
