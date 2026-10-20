# syntax=docker/dockerfile:1
#
# Targets:
#   runtime (default)  the API server
#   migrate            one-off job that applies database migrations
#
#   docker build -t multipleride-backend .
#   docker build --target migrate -t multipleride-backend-migrate .
#
# Configuration comes only from environment variables at run time (see .env.example).
# No secrets are baked into any image.

ARG NODE_IMAGE=node:24.21.0-alpine

# ---- dependencies, cached on the lockfile -----------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build: Prisma client + compiled JS, then drop everything not needed at run time -----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# --omit=optional also drops the Prisma CLI, Prisma Studio and TypeScript: they are optional
# peers of @prisma/client, so npm keeps them otherwise. The only other optional package is
# pg-cloudflare, which pg loads only on Cloudflare Workers.
RUN npm run build && npm prune --omit=dev --omit=optional --no-audit --no-fund

# ---- migrate: run with the MIGRATOR connection string, never the API one -----------------
FROM deps AS migrate
RUN apk add --no-cache openssl
COPY prisma.config.ts ./
COPY prisma ./prisma
# Fetch Prisma's schema engine at build time, so the job needs no network or write access later.
RUN node node_modules/prisma/build/index.js migrate diff \
      --from-empty --to-schema prisma/schema.prisma --script > /dev/null
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# ---- runtime: production dependencies and compiled code only, as a non-root user ---------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
