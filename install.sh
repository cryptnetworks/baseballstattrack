#!/usr/bin/env sh

set -eu

installer_image="${BST_INSTALLER_IMAGE:-ghcr.io/cryptnetworks/baseballstattrack-installer:latest}"
deployment_directory="${BST_DEPLOYMENT_DIRECTORY:-${PWD}/baseballstattrack-deployment}"

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

terminal_args=""
if [ -t 0 ] && [ -t 1 ]; then terminal_args="-it"; fi

# The socket grants the short-lived installer control of Docker. The image is
# published from reviewed source and stores generated files only in this mount.
# shellcheck disable=SC2086
exec docker run --rm ${terminal_args} --pull always \
  --env "BST_HOST_PLATFORM=${host_platform}" \
  --add-host host.docker.internal:host-gateway \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume "${deployment_directory}:/deployment" \
  --volume "${PWD}:/source:ro" \
  "${installer_image}" "$@"
