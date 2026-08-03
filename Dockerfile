# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436

FROM ${NODE_IMAGE} AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache ca-certificates openssl \
    && npm install --global npm@12.0.2

FROM base AS dependencies

COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS development

ENV NODE_ENV=development

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM dependencies AS builder

COPY . .

RUN test ! -e .git \
    && test ! -e .env \
    && test ! -e .vscode \
    && test ! -e tests \
    && mkdir -p public \
    && npm run build

FROM dependencies AS migration

ARG VCS_REF=unknown

ENV NODE_ENV=production

LABEL org.opencontainers.image.title="Baseball Stat Track migration runner" \
      org.opencontainers.image.description="Explicit Prisma migration runner for Baseball Stat Track" \
      org.opencontainers.image.source="https://github.com/cryptnetworks/baseballstattrack" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

USER node

ENTRYPOINT ["npm", "run", "db:migrate:deploy"]

FROM base AS runtime

ARG VCS_REF=unknown

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    REQUIRED_DATABASE_MIGRATION=20260803163000_provider_neutral_authentication

LABEL org.opencontainers.image.title="Baseball Stat Track" \
      org.opencontainers.image.description="Production-compatible Baseball Stat Track application image" \
      org.opencontainers.image.source="https://github.com/cryptnetworks/baseballstattrack" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/container/start.mjs ./container/start.mjs
COPY --from=builder /app/container/discord-update-scheduler.mjs ./container/discord-update-scheduler.mjs

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/ready`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["node", "container/start.mjs"]
