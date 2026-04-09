# ── Stage 1: build frontend assets ───────────────────────────────────────────
FROM node:lts-alpine AS builder

WORKDIR /app

# Install all deps (including devDeps for Vite)
COPY package.json package-lock.json* ./
RUN npm ci

# Only the public/ folder is needed for the frontend build
COPY public/ ./public/
COPY vite.config.js ./

RUN npm run build

# ── Stage 2: install production deps ─────────────────────────────────────────
FROM node:lts-alpine AS deps

WORKDIR /app

# Copy only manifest files to leverage layer cache
COPY package.json package-lock.json* ./

# Install production deps only
RUN npm ci --omit=dev

# ── Stage 2: final image ──────────────────────────────────────────────────────
FROM node:lts-alpine AS runtime

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy application source (excluding node_modules via .dockerignore)
COPY . .

# Hand ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENV NODE_ENV=production
# Ativar features de desenvolvimento (sala de teste, painel DEV in-game)
# Sobrescrever em tempo de execução com: docker run -e DEV_MODE=true ...
ENV DEV_MODE=false

CMD ["node", "server.js"]
