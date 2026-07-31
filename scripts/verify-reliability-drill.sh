#!/usr/bin/env bash

set -Eeuo pipefail

command -v docker >/dev/null || {
  echo "Reliability drill requires Docker." >&2
  exit 1
}
command -v npm >/dev/null || {
  echo "Reliability drill requires npm." >&2
  exit 1
}

drill_container="bst-reliability-$$_${RANDOM}"
drill_port="$((39000 + ($$ % 1000)))"
drill_database="baseballstattrack_reliability"
drill_user="reliability_drill"
drill_password="synthetic-reliability-drill-only"
postgres_image="postgres:17-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394"
drill_database_url="postgresql://${drill_user}:${drill_password}@127.0.0.1:${drill_port}/${drill_database}?schema=public"

cleanup_drill() {
  local drill_status=$?
  docker rm --force "${drill_container}" >/dev/null 2>&1 || true
  exit "${drill_status}"
}
trap cleanup_drill EXIT

wait_for_database() {
  for _ in {1..60}; do
    if docker exec "${drill_container}" pg_isready \
      --username "${drill_user}" --dbname "${drill_database}" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "Reliability drill database did not become ready." >&2
  return 1
}

database_query() {
  docker exec "${drill_container}" psql \
    --username "${drill_user}" --dbname "${drill_database}" \
    --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$1"
}

docker run --detach --name "${drill_container}" \
  --publish "127.0.0.1:${drill_port}:5432" \
  --env "POSTGRES_DB=${drill_database}" \
  --env "POSTGRES_USER=${drill_user}" \
  --env "POSTGRES_PASSWORD=${drill_password}" \
  "${postgres_image}" >/dev/null
wait_for_database

DATABASE_URL="${drill_database_url}" npm run db:migrate:deploy >/dev/null
docker exec --interactive "${drill_container}" psql \
  --username "${drill_user}" --dbname "${drill_database}" \
  --set ON_ERROR_STOP=1 <scripts/fixtures/backup-restore.sql >/dev/null

source_signature="$(
  database_query \
    'SELECT md5(string_agg("id" || '\'':'\'' || "payloadHash", '\'','\'' ORDER BY "sequence")) FROM "SourceEvent" WHERE "gameId" = '\''restore-game-a'\'';'
)"
source_event_count="$(database_query 'SELECT count(*) FROM "SourceEvent" WHERE "gameId" = '\''restore-game-a'\'';')"
correction_count="$(database_query 'SELECT count(*) FROM "EventCorrection" WHERE "gameId" = '\''restore-game-a'\'';')"
game_revision="$(database_query 'SELECT "revision" FROM "Game" WHERE "id" = '\''restore-game-a'\'';')"

[[ "${source_event_count}" == "4" ]]
[[ "${correction_count}" == "1" ]]
[[ "${game_revision}" == "4" ]]

detection_started="$(date +%s)"
database_query \
  'UPDATE "ProjectionCheckpoint" SET "status" = '\''STALE'\'', "failureCode" = '\''SYNTHETIC_STALE_PROJECTION_DRILL'\'' WHERE "id" = '\''restore-projection-a'\'';' >/dev/null
stale_games="$(
  database_query \
    'SELECT count(*) FROM "Game" g WHERE g."id" = '\''restore-game-a'\'' AND NOT EXISTS (SELECT 1 FROM "ProjectionCheckpoint" p WHERE p."accountId" = g."accountId" AND p."gameId" = g."id" AND p."scope" = '\''GAME'\'' AND p."sourceRevision" = g."revision" AND p."privacyOverlayRevision" = 0 AND p."derivationVersion" = 1 AND p."status" = '\''CURRENT'\'');'
)"
detection_seconds="$(($(date +%s) - detection_started))"
[[ "${stale_games}" == "1" ]]

recovery_started="$(date +%s)"
database_query \
  'UPDATE "ProjectionCheckpoint" SET "status" = '\''CURRENT'\'', "failureCode" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = '\''restore-projection-a'\'';' >/dev/null
current_projections="$(
  database_query \
    'SELECT count(*) FROM "ProjectionCheckpoint" p JOIN "Game" g ON g."accountId" = p."accountId" AND g."id" = p."gameId" WHERE g."id" = '\''restore-game-a'\'' AND p."status" = '\''CURRENT'\'' AND p."sourceRevision" = g."revision" AND p."privacyOverlayRevision" = 0 AND p."derivationVersion" = 1;'
)"
recovery_seconds="$(($(date +%s) - recovery_started))"
[[ "${current_projections}" == "1" ]]

recovered_signature="$(
  database_query \
    'SELECT md5(string_agg("id" || '\'':'\'' || "payloadHash", '\'','\'' ORDER BY "sequence")) FROM "SourceEvent" WHERE "gameId" = '\''restore-game-a'\'';'
)"
[[ "${recovered_signature}" == "${source_signature}" ]]
[[ "$(database_query 'SELECT count(*) FROM "EventCorrection" WHERE "gameId" = '\''restore-game-a'\'';')" == "${correction_count}" ]]
[[ "$(database_query 'SELECT "revision" FROM "Game" WHERE "id" = '\''restore-game-a'\'';')" == "${game_revision}" ]]
[[ "$(database_query 'SELECT count(*) FROM "SecurityAuditRecord" WHERE "accountId" = '\''restore-account-a'\'';')" == "1" ]]
[[ "$(database_query 'SELECT count(*) FROM "Account";')" == "2" ]]

echo "Reliability drill passed: scenario=stale_projection detection_seconds=${detection_seconds} recovery_seconds=${recovery_seconds} source_events=${source_event_count} corrections=${correction_count}."
