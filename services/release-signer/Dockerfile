FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node services/release-signer/ ./
RUN mkdir -p /var/log/release-signer && chown node:node /var/log/release-signer
USER node
ENV PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
