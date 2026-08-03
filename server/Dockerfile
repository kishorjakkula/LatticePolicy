FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --workspace=server

COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src
WORKDIR /app/server
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --workspace=server --omit=dev

COPY --from=build /app/server/dist ./dist
COPY products ./products
COPY tenants ./tenants
COPY server/migrations ./migrations

EXPOSE 3000
CMD ["node", "dist/index.js"]
