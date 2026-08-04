# ── build web ─────────────────────────────────────────────────────────
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── server deps (argon2 ставиться з prebuilt-бінарником, компілятор не потрібен) ─────
FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ── runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=web-build /app/web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist
ENV CONFIG_PATH=/data/config.json
ENV BRANDING_DIR=/data/branding
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
