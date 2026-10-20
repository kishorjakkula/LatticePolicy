# Test-only image for `npm run test:integration` (scripts/test-integration.sh).
# Never shipped or deployed.
#
# The server integration suite renders PDFs through Puppeteer, so the runner
# needs a working browser. It mirrors the production server image
# (server/Dockerfile): the same node:22-alpine base, Alpine's packaged
# Chromium and its libraries, Puppeteer's own download skipped, and
# PUPPETEER_EXECUTABLE_PATH pointed at the apk binary. Puppeteer's pinned
# Chrome for Testing is a glibc x86_64 build with no linux-arm64 variant, so it
# would not run here or on Apple Silicon Docker hosts.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE}

RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
