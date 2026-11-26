# Multi-stage Dockerfile otimizado para deploy no Railway (Backend + Frontend em 1 serviço)
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Instala e compila o Frontend
COPY frontend/package*.json ./frontend/
RUN npm ci --prefix frontend
COPY frontend ./frontend
RUN npm run build --prefix frontend

# 2. Instala e compila o Backend + gera Prisma Client
COPY backend/package*.json ./backend/
RUN npm ci --prefix backend
COPY backend ./backend
RUN npx --prefix backend prisma generate && npm run build --prefix backend

# --- Imagem final de produção ---
FROM node:22-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
# Recomendado montar um Volume no Railway em /app/data para persistir SQLite + sessão WhatsApp
ENV DATABASE_URL="file:/app/data/dev.db"
ENV WHATSAPP_SESSION_DIR="/app/data/auth_session"

COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data /app/data/auth_session

WORKDIR /app/backend

EXPOSE 3001

# Sincroniza o schema SQLite no Volume persistente e inicia o servidor
CMD ["sh", "-c", "mkdir -p /app/data/auth_session && npx prisma db push --skip-generate && node dist/index.js"]
