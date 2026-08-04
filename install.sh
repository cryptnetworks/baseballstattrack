#!/usr/bin/env sh

set -eu

installer_image="${BST_INSTALLER_IMAGE:-ghcr.io/cryptnetworks/baseballstattrack-installer:latest}"
installer_pull_policy="${BST_INSTALLER_PULL_POLICY:-always}"
deployment_directory="${BST_DEPLOYMENT_DIRECTORY:-${PWD}/baseballstattrack-deployment}"
source_directory="${BST_SOURCE_DIRECTORY:-${PWD}}"

case "${installer_pull_policy}" in
  always | missing | never) ;;
  *)
    echo "BST_INSTALLER_PULL_POLICY must be always, missing, or never." >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. See https://docs.docker.com/get-docker/ for your platform." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed, but its daemon is not reachable. Start Docker Desktop or Docker Engine." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. See https://docs.docker.com/compose/install/." >&2
  exit 1
fi

mkdir -p "${deployment_directory}"
chmod 700 "${deployment_directory}" 2>/dev/null || true
deployment_directory="$(CDPATH= cd "${deployment_directory}" && pwd -P)"
if [ ! -d "${source_directory}" ]; then
  echo "The installer source directory does not exist: ${source_directory}" >&2
  exit 1
fi
source_directory="$(CDPATH= cd "${source_directory}" && pwd -P)"

case "$(uname -s 2>/dev/null || true)" in
  Darwin) host_platform=macos ;;
  Linux)
    if [ -r /etc/os-release ] && grep -qi '^ID=.*nixos' /etc/os-release; then
      host_platform=nixos
    else
      host_platform=linux
    fi
    ;;
  *) host_platform=linux ;;
esac

bootstrap_compose="${deployment_directory}/compose.installer.yml"
bootstrap_environment="${deployment_directory}/.env.installer"
installer_project="baseballstattrack-installer-$$"
compose_temporary="${bootstrap_compose}.partial-$$"
environment_temporary="${bootstrap_environment}.partial-$$"
bootstrap_ready=false

quote_environment_value() {
  escaped="$(printf '%s' "$1" | sed "s/'/\\\\'/g")"
  printf "'%s'" "${escaped}"
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  rm -f "${compose_temporary}" "${environment_temporary}"
  if [ "${bootstrap_ready}" = true ]; then
    docker compose \
      --project-name "${installer_project}" \
      --file "${bootstrap_compose}" \
      --env-file "${bootstrap_environment}" \
      down --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "${status}"
}
trap cleanup EXIT HUP INT TERM

umask 077
{
  printf 'BST_INSTALLER_IMAGE='
  quote_environment_value "${installer_image}"
  printf '\nBST_INSTALLER_PULL_POLICY='
  quote_environment_value "${installer_pull_policy}"
  printf '\nBST_HOST_PLATFORM='
  quote_environment_value "${host_platform}"
  printf '\nBST_DEPLOYMENT_DIRECTORY='
  quote_environment_value "${deployment_directory}"
  printf '\nBST_SOURCE_DIRECTORY='
  quote_environment_value "${source_directory}"
  printf '\n'
} >"${environment_temporary}"

cat >"${compose_temporary}" <<'COMPOSE'
services:
  installer:
    image: ${BST_INSTALLER_IMAGE:?Set BST_INSTALLER_IMAGE in .env.installer}
    pull_policy: ${BST_INSTALLER_PULL_POLICY:-always}
    environment:
      BST_HOST_PLATFORM: ${BST_HOST_PLATFORM:?Set BST_HOST_PLATFORM in .env.installer}
      BST_DEPLOYMENT_DIR: /deployment
      BST_SOURCE_DIR: /source
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - type: bind
        source: ${BST_DEPLOYMENT_DIRECTORY:?Set BST_DEPLOYMENT_DIRECTORY in .env.installer}
        target: /deployment
      - type: bind
        source: ${BST_SOURCE_DIRECTORY:?Set BST_SOURCE_DIRECTORY in .env.installer}
        target: /source
        read_only: true
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
COMPOSE

chmod 600 "${environment_temporary}" "${compose_temporary}" 2>/dev/null || true
mv -f "${environment_temporary}" "${bootstrap_environment}"
mv -f "${compose_temporary}" "${bootstrap_compose}"
bootstrap_ready=true

docker compose \
  --project-name "${installer_project}" \
  --file "${bootstrap_compose}" \
  --env-file "${bootstrap_environment}" \
  config --quiet

if [ -t 0 ] && [ -t 1 ]; then
  docker compose \
    --project-name "${installer_project}" \
    --file "${bootstrap_compose}" \
    --env-file "${bootstrap_environment}" \
    run --rm installer "$@"
else
  docker compose \
    --project-name "${installer_project}" \
    --file "${bootstrap_compose}" \
    --env-file "${bootstrap_environment}" \
    run --rm --no-TTY installer "$@"
fi
