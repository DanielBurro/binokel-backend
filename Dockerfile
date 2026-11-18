# Node-Version passend zu .nvmrc und engines in package.json
ARG NODE_IMAGE=node:22-alpine

# Build-Stage: kompiliert TypeScript nach dist/
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: Das prepare-Skript ruft husky auf, das im Image weder nötig noch sinnvoll ist.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runner-Stage: nur Laufzeitabhängigkeiten und kompilierter Code
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
# --omit=dev ersetzt das veraltete --only=production; ohne --ignore-scripts bräche husky ab.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000
# wget kommt mit BusyBox aus dem Alpine-Image und ist leichter als ein zusätzlicher Node-Prozess.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
# Exec-Form, damit SIGTERM direkt bei Node ankommt und der Graceful Shutdown greift.
CMD ["node", "dist/index.js"]
