FROM node:24-alpine AS base
RUN apk add --no-cache ca-certificates
RUN corepack enable && corepack install -g pnpm@12.6.0

ENV CI=true

FROM base AS manifests
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY vite.config.ts tsconfig.base.json ./

FROM manifests AS client
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch
COPY packages/client/package.json packages/client/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm i --frozen-lockfile
COPY . .
# Stamps the build version shown in the app; changes every commit, so it comes after the installs
ARG GITHUB_SHA
RUN pnpm build:ext

FROM scratch AS extension
COPY --from=client /app/packages/client/dist-extension /

FROM manifests AS server-build
# Installs before the sources arrive, so a code change doesn't reinstall
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm i --frozen-lockfile --filter @newtab-todo/server --filter @newtab-todo/shared
COPY packages/server/tsconfig.json packages/server/vite.config.ts packages/server/drizzle.config.ts ./packages/server/
COPY packages/shared/src ./packages/shared/src
COPY packages/server/src ./packages/server/src
RUN pnpm --filter @newtab-todo/server build
RUN pnpm --filter @newtab-todo/server --prod deploy --legacy /app/deploy

# CI pushes the schema from here before deploying, building it uncached so it runs every time.
# Without a TTY, a rename or data-loss change exits 2 and stops the deploy; push those by hand.
FROM server-build AS schema
WORKDIR /app/packages/server
# Not `pnpm db:push`: pnpm reinstalls before running a script, and after the --prod deploy above
# that reinstall prunes the dev dependencies, drizzle-kit among them
RUN --mount=type=secret,id=TURSO_DATABASE_URL,env=TURSO_DATABASE_URL \
    --mount=type=secret,id=TURSO_AUTH_TOKEN,env=TURSO_AUTH_TOKEN \
    node_modules/.bin/drizzle-kit push --verbose

FROM node:24-alpine AS server
RUN apk add --no-cache ca-certificates tini
WORKDIR /app
COPY --from=server-build /app/deploy .
COPY --from=client /app/packages/client/dist ./client/dist
ENV CLIENT_DIST_PATH=/app/client/dist
EXPOSE 3000
# tini -g forwards signals to the whole process group (sh + node),
# so SIGTERM from Fly reaches node directly for graceful shutdown.
# The restart loop keeps the machine alive for clean Fly snapshots —
# without it, a node crash kills tini (PID 1) and the machine goes
# fully stopped instead of suspended, breaking resume.
ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["sh", "-c", "while true; do node dist/index.js; code=$?; [ $code -eq 0 ] && exit 0; echo \"server exited ($code), restarting in 1s\"; sleep 1; done"]
