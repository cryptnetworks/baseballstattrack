#!/usr/bin/env sh
set -eu

case "${1:-}" in
  *Username*)
    printf '%s\n' "x-access-token"
    ;;
  *Password*)
    test -n "${WIKI_PUBLISH_TOKEN:-}"
    printf '%s\n' "${WIKI_PUBLISH_TOKEN}"
    ;;
  *)
    exit 1
    ;;
esac
