FROM node:20-alpine AS build
WORKDIR /app

# Install deps
COPY server/package*.json ./
RUN npm ci

# Build
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY products ./products
COPY tenants ./tenants
COPY server/migrations ./migrations

EXPOSE 3000
CMD ["node", "dist/index.js"]
