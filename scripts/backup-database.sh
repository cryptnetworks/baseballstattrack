#!/usr/bin/env bash

set -Eeuo pipefail

backup_database_url="${DATABASE_URL:-}"
backup_destination="${BACKUP_DESTINATION:-}"

[[ -n "${backup_database_url}" ]] ||
  { echo "DATABASE_URL is required." >&2; exit 1; }
[[ -n "${backup_destination}" ]] ||
  { echo "BACKUP_DESTINATION is required." >&2; exit 1; }
command -v pg_dump >/dev/null ||
  { echo "pg_dump is required." >&2; exit 1; }

umask 077
backup_parent="$(dirname "${backup_destination}")"
mkdir -p "${backup_parent}"
backup_temporary="${backup_destination}.partial.$$"
checksum_temporary="${backup_destination}.sha256.partial.$$"

cleanup_backup() {
  rm -f "${backup_temporary}" "${checksum_temporary}"
}
trap cleanup_backup EXIT

pg_dump \
  --dbname="${backup_database_url}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="${backup_temporary}"

pg_restore --list "${backup_temporary}" >/dev/null
sha256sum "${backup_temporary}" |
  sed "s#${backup_temporary}#$(basename "${backup_destination}")#" \
    >"${checksum_temporary}"

mv "${backup_temporary}" "${backup_destination}"
mv "${checksum_temporary}" "${backup_destination}.sha256"
chmod 600 "${backup_destination}" "${backup_destination}.sha256"
trap - EXIT

echo "Backup archive and checksum created."
