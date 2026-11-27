# syntax=docker/dockerfile:1
# React Router SSR server. Build from the repo root: docker build -f apps/web/Dockerfile .

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# pnpm comes from "packageManager"; packages come from the lockfile alone, so this
# layer is reused until pnpm-lock.yaml changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store
RUN pnpm --filter @buildwith/web build

# Production dependencies only: web and the workspace packages it imports, from the lockfile.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
COPY packages/ packages/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --prefer-offline --store-dir /pnpm/store --filter '@buildwith/web...'

FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production PORT=3000
# Same /repo layout as the build so pnpm's relative node_modules symlinks resolve.
WORKDIR /repo/apps/web
COPY --from=prod-deps /repo/ /repo/
COPY --from=build /repo/apps/web/build/ ./build/
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/buildwithuz/buildwith" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
# The image's "node" user (uid 1000) runs the server; the app files stay root-owned and read-only to it.
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
