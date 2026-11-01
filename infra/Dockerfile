# INTRANET ZERO — multi-stage image (master prompt §17.1).
# Build:  docker build -f infra/Dockerfile .
# Run:    docker run -p 8080:8080 --env-file .env iz-app

FROM node:24-slim AS build
WORKDIR /app
# pnpm via corepack; npm fallback in case corepack is unavailable in the base image
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate || npm i -g pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json ./
COPY packages ./packages
COPY apps ./apps
COPY worlds ./worlds
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
# Compile the public tutorial world into the image (private worlds come from
# the separate content repo via a mounted WORLDS_DIR at deploy time).
# The build report goes OUTSIDE WORLDS_DIR: the server fail-closes on any
# non-bundle JSON it finds there (§16).
ARG BUILD_SALT=0123456789abcdef0123456789abcdef
RUN node packages/compiler/dist/cli.js build worlds/tutorial --out dist/worlds --salt "${BUILD_SALT}" --report dist/worlds-report.json

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pnpm's workspace node_modules uses relative symlinks, so a plain copy works.
COPY --from=build /app ./
USER node
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
