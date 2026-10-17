FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_SHOW_DEMO_CREDENTIALS
ENV VITE_SHOW_DEMO_CREDENTIALS=${VITE_SHOW_DEMO_CREDENTIALS}
ARG VITE_CARRIER_TENANT_ID
ENV VITE_CARRIER_TENANT_ID=${VITE_CARRIER_TENANT_ID}

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY server/package.json ./server/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/rules/package.json ./packages/rules/package.json
RUN npm ci --workspace=frontend

# Shared runtime package, bundled from source by Vite (see vite.config.ts).
COPY packages/rules/src ./packages/rules/src
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
# Rewrites /runtime-config.js from LATTICE_* env vars at container start, so
# one published image can be pointed at any carrier stack.
COPY frontend/docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
