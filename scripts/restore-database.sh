#!/usr/bin/env bash

set -Eeuo pipefail

restore_database_url="${RESTORE_DATABASE_URL:-}"
restore_source="${RESTORE_SOURCE:-}"

[[ -n "${restore_database_url}" ]] ||
  { echo "RESTORE_DATABASE_URL is required." >&2; exit 1; }
[[ -f "${restore_source}" ]] ||
  { echo "RESTORE_SOURCE must name an existing archive." >&2; exit 1; }
[[ -f "${restore_source}.sha256" ]] ||
  { echo "The matching SHA-256 file is required." >&2; exit 1; }
command -v pg_restore >/dev/null ||
  { echo "pg_restore is required." >&2; exit 1; }

(
  cd "$(dirname "${restore_source}")"
  sha256sum --check "$(basename "${restore_source}").sha256"
)
pg_restore --list "${restore_source}" >/dev/null

existing_relations="$(
  psql "${restore_database_url}" --tuples-only --no-align \
    --command="SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p');"
)"
[[ "${existing_relations}" == "0" ]] ||
  { echo "Restore target must have an empty public schema." >&2; exit 1; }

pg_restore \
  --dbname="${restore_database_url}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-acl \
  "${restore_source}"

echo "Backup restored transactionally."
