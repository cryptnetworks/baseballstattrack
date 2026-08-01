#!/usr/bin/env bash

set -Eeuo pipefail

migration_root="${MIGRATION_ROOT:-prisma/migrations}"

repository_migration_manifest() {
  local root=$1
  local migration_name
  while IFS= read -r migration_name; do
    [[ -f "${root}/${migration_name}/migration.sql" ]] || {
      echo "Migration directory ${migration_name} has no migration.sql." >&2
      return 1
    }
    printf '%s\n' "${migration_name}"
  done < <(
    find "${root}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; |
      LC_ALL=C sort
  )
}

if [[ "${MIGRATION_INVENTORY_ONLY:-0}" == "1" ]]; then
  repository_migration_manifest "${migration_root}"
  exit
fi

expected_migrations="$(repository_migration_manifest "${migration_root}")"
[[ -n "${expected_migrations}" ]] || {
  echo "No checked-in migrations were found." >&2
  exit 1
}

restore_project="bst-restore-$$_${RANDOM}"
source_container="${restore_project}-source"
target_container="${restore_project}-target"
restore_network="${restore_project}-network"
migration_image="${restore_project}-migration:local"
postgres_image="postgres:17-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394"
restore_password="synthetic-restore-drill-only"
restore_database="baseballstattrack_restore"
restore_user="restore_drill"
restore_workspace="$(mktemp -d)"
backup_archive="${restore_workspace}/baseballstattrack.dump"

cleanup_restore() {
  local restore_status=$?
  docker rm --force "${source_container}" "${target_container}" >/dev/null 2>&1 || true
  docker network rm "${restore_network}" >/dev/null 2>&1 || true
  docker image rm "${migration_image}" >/dev/null 2>&1 || true
  rm -rf "${restore_workspace}"
  exit "${restore_status}"
}
trap cleanup_restore EXIT

wait_for_database() {
  local restore_container=$1
  for _ in {1..60}; do
    if docker exec "${restore_container}" pg_isready \
      --username "${restore_user}" --dbname "${restore_database}" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "Restore drill database did not become ready." >&2
  return 1
}

database_query() {
  local restore_container=$1
  local restore_query=$2
  docker exec "${restore_container}" psql \
    --username "${restore_user}" --dbname "${restore_database}" \
    --tuples-only --no-align --command "${restore_query}"
}

docker network create "${restore_network}" >/dev/null
for restore_container in "${source_container}" "${target_container}"; do
  docker run --detach --name "${restore_container}" --network "${restore_network}" \
    --env "POSTGRES_DB=${restore_database}" \
    --env "POSTGRES_USER=${restore_user}" \
    --env "POSTGRES_PASSWORD=${restore_password}" \
    "${postgres_image}" >/dev/null
  wait_for_database "${restore_container}"
done

docker build --target migration --tag "${migration_image}" . >/dev/null
docker run --rm --network "${restore_network}" \
  --env NODE_ENV=production \
  --env NEXT_PUBLIC_APP_ENV=local \
  --env "DATABASE_URL=postgresql://${restore_user}:${restore_password}@${source_container}:5432/${restore_database}?schema=public" \
  --env REQUIRED_DATABASE_MIGRATION=20260801050000_discord_update_cadence \
  "${migration_image}" npm run db:migrate:deploy >/dev/null

docker exec --interactive "${source_container}" psql \
  --username "${restore_user}" --dbname "${restore_database}" \
  --set ON_ERROR_STOP=1 <scripts/fixtures/backup-restore.sql >/dev/null

source_signature="$(
  database_query "${source_container}" \
    "SELECT md5(string_agg(\"id\" || ':' || \"payloadHash\", ',' ORDER BY \"sequence\")) FROM \"SourceEvent\";"
)"

backup_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker cp scripts/backup-database.sh "${source_container}:/tmp/backup-database.sh"
docker exec \
  --env "DATABASE_URL=postgresql://${restore_user}:${restore_password}@127.0.0.1:5432/${restore_database}" \
  --env BACKUP_DESTINATION=/tmp/baseballstattrack.dump \
  "${source_container}" bash /tmp/backup-database.sh >/dev/null
docker cp "${source_container}:/tmp/baseballstattrack.dump" "${backup_archive}"
docker cp "${source_container}:/tmp/baseballstattrack.dump.sha256" "${backup_archive}.sha256"

docker cp scripts/restore-database.sh "${target_container}:/tmp/restore-database.sh"
docker cp "${backup_archive}" "${target_container}:/tmp/baseballstattrack.dump"
docker cp "${backup_archive}.sha256" "${target_container}:/tmp/baseballstattrack.dump.sha256"
restore_started_epoch="$(date +%s)"
docker exec \
  --env "RESTORE_DATABASE_URL=postgresql://${restore_user}:${restore_password}@127.0.0.1:5432/${restore_database}" \
  --env RESTORE_SOURCE=/tmp/baseballstattrack.dump \
  "${target_container}" bash /tmp/restore-database.sh >/dev/null
restore_duration_seconds="$(($(date +%s) - restore_started_epoch))"

target_signature="$(
  database_query "${target_container}" \
    "SELECT md5(string_agg(\"id\" || ':' || \"payloadHash\", ',' ORDER BY \"sequence\")) FROM \"SourceEvent\";"
)"
[[ "${source_signature}" == "${target_signature}" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "Account";')" == "2" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "AccountMembership" WHERE "status" = '\''ACTIVE'\'';')" == "1" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "Team";')" == "2" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "Season";')" == "1" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "RosterEntry";')" == "1" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "Game" WHERE "status" = '\''CORRECTED'\'' AND "revision" = 4;')" == "1" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "SourceEvent";')" == "4" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "EventCorrection";')" == "1" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "SecurityAuditRecord";')" == "1" ]]
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "ProjectionCheckpoint" WHERE "status" = '\''CURRENT'\'';')" == "1" ]]
applied_migrations="$(
  database_query "${target_container}" \
    'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY "migration_name";'
)"
inconsistent_migrations="$(
  database_query "${target_container}" \
    'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL;'
)"
if [[ "${applied_migrations}" != "${expected_migrations}" ]]; then
  echo "Restored migration inventory does not match the repository." >&2
  diff -u \
    <(printf '%s\n' "${expected_migrations}") \
    <(printf '%s\n' "${applied_migrations}") >&2 || true
  exit 1
fi
[[ "${inconsistent_migrations}" == "0" ]] || {
  echo "Restored migration history contains incomplete or rolled-back rows." >&2
  exit 1
}
[[ "$(database_query "${target_container}" 'SELECT count(*) FROM "Team" t JOIN "Account" a ON a."id" = t."accountId" WHERE t."accountId" <> a."id";')" == "0" ]]

cp "${backup_archive}" "${backup_archive}.corrupt"
truncate -s 128 "${backup_archive}.corrupt"
if docker exec --interactive "${target_container}" pg_restore --list \
  <"${backup_archive}.corrupt" >/dev/null 2>&1; then
  echo "Corrupt backup unexpectedly passed its integrity probe." >&2
  exit 1
fi

echo "Backup restore drill passed: archive=${backup_started_at} restore_seconds=${restore_duration_seconds}."
