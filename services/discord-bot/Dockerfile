# syntax=docker/dockerfile:1.7

FROM python:3.12-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

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

RUN groupadd --system --gid 10001 bot \
    && useradd --system --uid 10001 --gid bot --home-dir /nonexistent --shell /usr/sbin/nologin bot

COPY requirements.lock ./requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --disable-pip-version-check --no-deps --require-hashes --requirement requirements.lock

COPY src ./src

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/readyz', timeout=2)"]

ENTRYPOINT ["python", "-m", "baseballstattrack_discord.main"]
