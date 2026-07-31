#!/usr/bin/env bash

set -Eeuo pipefail

image_prefix="${IMAGE_PREFIX:-baseballstattrack}"
image_tag="${IMAGE_TAG:-local}"
vcs_ref="${VCS_REF:-unknown}"

if [[ ! "${image_tag}" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]]; then
  echo "IMAGE_TAG must be a valid lowercase container tag" >&2
  exit 1
fi

docker build \
  --target runtime \
  --build-arg "VCS_REF=${vcs_ref}" \
  --tag "${image_prefix}:${image_tag}" \
  .

docker build \
  --target migration \
  --build-arg "VCS_REF=${vcs_ref}" \
  --tag "${image_prefix}-migration:${image_tag}" \
  .

docker build \
  --build-arg "VCS_REF=${vcs_ref}" \
  --tag "${image_prefix}-discord-bot:${image_tag}" \
  services/discord-bot
