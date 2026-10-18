FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node services/document-processor/ ./services/document-processor/
COPY --chown=node:node services/document-learning/ ./services/document-learning/
USER node
ENTRYPOINT ["node", "services/document-learning/cli.mjs"]
