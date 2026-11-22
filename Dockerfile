ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=true

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && node node_modules/@prisma/engines/scripts/postinstall.js

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY src ./src
COPY prisma ./prisma
RUN npm run build

# CI/migration tooling is a separate target and is NEVER published as the runtime.
FROM build AS tooling
COPY test ./test
COPY eslint.config.mjs .prettierrc .prettierignore ./
COPY .env.example ./.env.example
RUN chown -R node:node /app
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM deps AS production-deps
RUN npm prune --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
 && npm audit --omit=dev --omit=optional --audit-level=high

FROM base AS runtime
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/pickupandgo/PickUp" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.title="MultipleRide Trip Engine"
ENV NODE_ENV=production PORT=3000 OUTBOX_POLL_INTERVAL_MS=0 DISPATCH_POLL_INTERVAL_MS=0
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=7s --start-period=15s --retries=3 \
 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready',{signal:AbortSignal.timeout(6000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
