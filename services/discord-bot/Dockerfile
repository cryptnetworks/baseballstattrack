# syntax=docker/dockerfile:1.7

FROM python:3.12-alpine3.23@sha256:167bc85084c9df34480efc26b4528fb68feaa8a79183b5658952137025b6f061

ARG VCS_REF=unknown

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    HEALTH_HOST=0.0.0.0 \
    HEALTH_PORT=8080

WORKDIR /app

LABEL org.opencontainers.image.title="Baseball Stat Track Discord bot" \
      org.opencontainers.image.description="Read-only Discord statistics bot for Baseball Stat Track" \
      org.opencontainers.image.source="https://github.com/cryptnetworks/baseballstattrack" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

# The pinned Python image includes fixed OpenSSL and SQLite, but still carries
# libuuid from before the util-linux security fixes.
RUN apk add --no-cache --upgrade 'libuuid>=2.41.6-r1' \
    && addgroup -S -g 10001 bot \
    && adduser -S -D -H -u 10001 -G bot bot

COPY requirements.lock ./requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --disable-pip-version-check --no-deps --require-hashes --requirement requirements.lock

COPY src ./src

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/readyz', timeout=2)"]

ENTRYPOINT ["python", "-m", "baseballstattrack_discord.main"]
