# syntax=docker/dockerfile:1.20.0

ARG NODE_IMAGE=node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436
FROM ${NODE_IMAGE}

ARG VCS_REF=unknown

RUN apk add --no-cache \
    ca-certificates \
    docker-cli \
    docker-cli-buildx \
    docker-cli-compose \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /installer
COPY scripts/deploy/*.ts ./
COPY docker-compose.yml ./assets/docker-compose.yml

ENV BST_DEPLOYMENT_DIR=/deployment \
    BST_INSTALLER_ASSET_DIR=/installer/assets \
    BST_HEALTH_HOST=host.docker.internal \
    BST_RELEASE_SHA=${VCS_REF}

LABEL org.opencontainers.image.source="https://github.com/cryptnetworks/baseballstattrack" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="Baseball Stat Track deployment installer"

ENTRYPOINT ["node", "/installer/install.ts"]
CMD ["install"]
