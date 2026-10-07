FROM node:20-alpine AS build
WORKDIR /app
RUN apk upgrade --no-cache libcrypto3 libssl3
# The build stage only type-checks/compiles TypeScript — it never launches a
# browser — so skip Puppeteer's own Chromium download here entirely. It would
# be glibc-built and incompatible with this musl-based Alpine image anyway;
# the runtime stage below installs Alpine's own `chromium` package instead
# and points Puppeteer at it via PUPPETEER_EXECUTABLE_PATH.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --workspace=server

COPY packages/types/src ./packages/types/src
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src
WORKDIR /app/server
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk upgrade --no-cache libcrypto3 libssl3

# System Chromium + the shared libraries it needs to actually run headless on
# Alpine (musl). This is the standard, documented combination for running
# Puppeteer-driven Chromium on Alpine — Puppeteer's own bundled/managed
# Chromium download is a glibc build and will not run here, hence
# PUPPETEER_SKIP_DOWNLOAD above and PUPPETEER_EXECUTABLE_PATH below pointing
# at this apk-installed binary instead.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --workspace=server --omit=dev \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/server/dist ./server/dist
COPY contracts ./contracts
COPY products ./products
COPY tenants ./tenants
COPY server/migrations ./server/migrations

EXPOSE 3000
CMD ["node", "server/dist/index.js"]
