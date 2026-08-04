#!/usr/bin/env bash

set -Eeuo pipefail

project_name="bst-container-$$_${RANDOM}"
app_image="${project_name}-app:local"
migration_image="${project_name}-migration:local"
discord_bot_image="${project_name}-discord-bot:local"
installer_image="${project_name}-installer:local"
app_port="$((32000 + ($$ % 1000)))"
unavailable_database_port="$((36000 + ($$ % 1000)))"
unavailable_database_container="${project_name}-unavailable-database"
occupied_port_container="${project_name}-occupied-port"
compose=(docker compose --project-name "${project_name}")

export APP_IMAGE="${app_image}"
export MIGRATION_IMAGE="${migration_image}"
export DISCORD_BOT_IMAGE="${discord_bot_image}"
export IMAGE_PULL_POLICY=never
export COMPOSE_PROFILES=discord-control-plane
export APP_ENV_FILE=./.env.production.example
export APP_PORT="${app_port}"
export POSTGRES_DB=baseballstattrack_smoke
export POSTGRES_USER=baseballstattrack_smoke
export POSTGRES_PASSWORD=synthetic-container-smoke-only
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public"
export DIRECT_URL="${DATABASE_URL}"
export NEXT_PUBLIC_SITE_URL=https://app.example.test
export AUTHENTICATION_ENCRYPTION_KEY=MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE
export AUTHENTICATION_ENABLED_PROVIDERS=google
export OAUTH_CALLBACK_URL=https://app.example.test/auth/callback
export GOOGLE_OAUTH_CLIENT_ID=synthetic-google-client-id
export GOOGLE_OAUTH_CLIENT_SECRET=synthetic-google-client-secret
export WEBHOOK_SIGNING_MASTER_KEY=synthetic_webhook_signing_master_key_1234567890
export WEBHOOK_WORKER_TOKEN=synthetic-webhook-worker-token-1234567890
export EXTERNAL_INGESTION_WORKER_TOKEN=synthetic-ingestion-worker-token-1234567890
export ICS_FEED_SIGNING_KEY=synthetic-ics-signing-key-1234567890
export NOTIFICATION_WORKER_TOKEN=synthetic-notification-worker-token-1234567890
export NOTIFICATION_EVENT_TOKEN=synthetic-notification-event-token-1234567890
export NOTIFICATION_DISCORD_BOT_TOKEN=synthetic-notification-discord-token-1234567890
export EXTERNAL_DATA_PROVIDER_API_KEY=synthetic-provider-api-key
export EXTERNAL_DATA_PROVIDER_ALLOWED_ORIGIN=https://provider.example.test
export DISCORD_PROVIDER_MODE=stub
export DISCORD_TOKEN=
export BST_API_TOKEN=
export BST_API_BASE_URL=https://app.example.test
export BST_WEB_BASE_URL=https://app.example.test
export DISCORD_TEAM_BINDINGS='[]'
export DISCORD_UPDATE_WORKER_TOKEN=synthetic-discord-update-worker-token-1234567890
export DISCORD_UPDATE_WORKER_ID=discord-smoke-worker
export DISCORD_UPDATE_WORKER_INTERVAL_SECONDS=5
export DISCORD_UPDATE_WORKER_TIMEOUT_SECONDS=10
export VCS_REF="${GITHUB_SHA:-local-smoke}"

cleanup() {
  local exit_code=$?

  if ((exit_code != 0)); then
    echo "Container smoke test failed; service state and logs follow." >&2
    "${compose[@]}" ps --all >&2 || true
    "${compose[@]}" logs --no-color >&2 || true
    docker logs "${unavailable_database_container}" >&2 || true
  fi

  docker rm --force \
    "${unavailable_database_container}" \
    "${occupied_port_container}" >/dev/null 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm \
    "${app_image}" \
    "${migration_image}" \
    "${discord_bot_image}" \
    "${installer_image}" >/dev/null 2>&1 || true

  exit "${exit_code}"
}

trap cleanup EXIT

fail() {
  echo "Container smoke test failed: $*" >&2
  return 1
}

wait_for_status() {
  local url=$1
  local expected_status=$2
  local attempts=${3:-60}
  local status

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
      --max-time 2 "${url}" || true)"
    if [[ "${status}" == "${expected_status}" ]]; then
      return 0
    fi
    sleep 1
  done

  fail "${url} did not return ${expected_status} after ${attempts} attempts"
}

database_query() {
  "${compose[@]}" exec --no-TTY db \
    psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
    --tuples-only --no-align --command "$1"
}

latest_migration="$(
  find prisma/migrations -mindepth 1 -maxdepth 1 -type d -print |
    sort |
    tail -n 1 |
    xargs basename
)"

[[ -n "${latest_migration}" ]] || fail "no Prisma migration was found"
[[ "$(grep --fixed-strings --count "${latest_migration}" Dockerfile)" == "1" ]] ||
  fail "Dockerfile readiness pin is not the latest migration"
echo "Validating Compose configuration."
"${compose[@]}" config --quiet

echo "Building production and migration images outside Compose."
docker build \
  --target runtime \
  --build-arg "VCS_REF=${VCS_REF}" \
  --tag "${app_image}" \
  .
docker build \
  --target migration \
  --build-arg "VCS_REF=${VCS_REF}" \
  --tag "${migration_image}" \
  .
docker build \
  --build-arg "VCS_REF=${VCS_REF}" \
  --tag "${discord_bot_image}" \
  services/discord-bot
docker build \
  --file scripts/deploy/Dockerfile \
  --build-arg "VCS_REF=${VCS_REF}" \
  --tag "${installer_image}" \
  .

installer_help="$(docker run --rm "${installer_image}" --help)"
[[ "${installer_help}" == *"Docker deployment wizard"* ]] ||
  fail "installer image did not expose its help entry point"
docker run --rm --entrypoint sh "${installer_image}" -c '
  test -f /installer/assets/docker-compose.yml
  test ! -e /installer/.env.production
  test ! -e /installer/node_modules
  test ! -e /usr/local/lib/node_modules/npm
  ! command -v npm
  ! command -v npx
  docker buildx version
'

image_configuration="$(
  docker image inspect "${app_image}" \
    --format '{{.Config.User}}|{{json .Config.Entrypoint}}|{{json .Config.Healthcheck.Test}}'
)"
runtime_user="${image_configuration%%|*}"
[[ -n "${runtime_user}" && "${runtime_user}" != "0" && "${runtime_user}" != "root" ]] ||
  fail "production image does not declare a non-root runtime user"
[[ "${image_configuration}" != *"next dev"* ]] ||
  fail "production image starts the development server"
[[ "${image_configuration}" == *"/api/ready"* ]] ||
  fail "production image health check does not use readiness"

docker run --rm --entrypoint node "${app_image}" --input-type=commonjs -e '
  const fs = require("node:fs");
  const required = [
    "/app/server.js",
    "/app/.next/static",
    "/app/public",
    "/app/container/start.mjs",
    "/app/container/discord-update-scheduler.mjs",
  ];
  const forbidden = [
    "/app/.git",
    "/app/.env",
    "/app/.vscode",
    "/app/docs",
    "/app/src",
    "/app/tests",
    "/app/package-lock.json",
    "/app/node_modules/.cache",
    "/app/node_modules/typescript",
    "/app/node_modules/vitest",
    "/app/node_modules/prisma",
  ];
  for (const path of required) {
    if (!fs.existsSync(path)) throw new Error(`required runtime path is absent: ${path}`);
  }
  for (const path of forbidden) {
    if (fs.existsSync(path)) throw new Error(`forbidden runtime path is present: ${path}`);
  }
'

bot_configuration="$(
  docker image inspect "${discord_bot_image}" \
    --format '{{.Config.User}}|{{json .Config.Entrypoint}}|{{json .Config.Healthcheck.Test}}'
)"
bot_runtime_user="${bot_configuration%%|*}"
[[ -n "${bot_runtime_user}" && "${bot_runtime_user}" != "0" && "${bot_runtime_user}" != "root" ]] ||
  fail "Discord bot image does not declare a non-root runtime user"
[[ "${bot_configuration}" == *"/readyz"* ]] ||
  fail "Discord bot image health check does not use readiness"

image_history="$(docker history --no-trunc "${app_image}")"
[[ "${image_history}" != *"${POSTGRES_PASSWORD}"* ]] ||
  fail "synthetic database password appeared in image history"
[[ "${image_history}" != *"postgresql://"* ]] ||
  fail "a database URL appeared in image history"

echo "Exercising fatal configuration failures."
set +e
missing_environment_output="$(
  docker run --rm \
    --env NEXT_PUBLIC_APP_ENV=local \
    --env DATABASE_URL= \
    "${app_image}" 2>&1
)"
missing_environment_status=$?
invalid_database_output="$(
  docker run --rm \
    --env NEXT_PUBLIC_APP_ENV=local \
    --env DATABASE_URL=not-a-postgresql-url \
    "${app_image}" 2>&1
)"
invalid_database_status=$?
migration_failure_output="$(
  docker run --rm --network none \
    --env NEXT_PUBLIC_APP_ENV=local \
    --env DATABASE_URL=postgresql://smoke:synthetic-migration-secret@127.0.0.1:1/unavailable \
    "${migration_image}" 2>&1
)"
migration_failure_status=$?
set -e

((missing_environment_status != 0)) ||
  fail "production container accepted a missing DATABASE_URL"
[[ "${missing_environment_output}" == *"DATABASE_URL is required"* ]] ||
  fail "missing DATABASE_URL did not produce an actionable error"
((invalid_database_status != 0)) ||
  fail "production container accepted an invalid DATABASE_URL"
[[ "${invalid_database_output}" == *"valid PostgreSQL URL"* ]] ||
  fail "invalid DATABASE_URL did not produce an actionable error"
((migration_failure_status != 0)) ||
  fail "migration runner succeeded with an unavailable database"
[[ "${migration_failure_output}" != *"synthetic-migration-secret"* ]] ||
  fail "migration failure disclosed the database password"

echo "Starting a clean database volume."
"${compose[@]}" up --detach --wait db
[[ "$(database_query "SELECT to_regclass('public.\"_prisma_migrations\"') IS NULL;")" == "t" ]] ||
  fail "clean database unexpectedly contains the migration table"

echo "Applying the one-shot migration and waiting for application readiness."
"${compose[@]}" up --detach --wait app
wait_for_status "http://127.0.0.1:${app_port}/api/ready" "200"
wait_for_status "http://127.0.0.1:${app_port}/" "200"
wait_for_status "http://127.0.0.1:${app_port}/status" "200"

readiness_body="$(curl --silent --show-error "http://127.0.0.1:${app_port}/api/ready")"
[[ "${readiness_body}" == *'"status":"ready"'* ]] ||
  fail "readiness response did not report ready"

echo "Starting the secretless Discord control plane."
"${compose[@]}" up --detach --wait discord-bot discord-update-worker
"${compose[@]}" exec --no-TTY discord-bot sh -c '
  test "$(id -u)" -ne 0
  test -z "${DISCORD_TOKEN}"
  test -z "${BST_API_TOKEN}"
  test -z "${DATABASE_URL:-}"
  ! touch /app/bot-runtime-write-check 2>/dev/null
  python -c "import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:8080/readyz\", timeout=2)"
'
"${compose[@]}" exec --no-TTY discord-update-worker sh -c '
  test "$(id -u)" -ne 0
  test -z "${DATABASE_URL:-}"
  ! touch /app/worker-runtime-write-check 2>/dev/null
  node -e "fetch(\"http://127.0.0.1:8080/readyz\").then((response) => { if (!response.ok) process.exit(1); })"
'

control_plane_logs="$(
  "${compose[@]}" logs --no-color discord-bot discord-update-worker
)"
[[ "${control_plane_logs}" == *"discord_provider_stub_ready"* ]] ||
  fail "Discord provider stub did not report readiness"
[[ "${control_plane_logs}" == *"worker_cycle_succeeded"* ]] ||
  fail "Discord update scheduler did not complete a synthetic cycle"
[[ "${control_plane_logs}" != *"${DISCORD_UPDATE_WORKER_TOKEN}"* ]] ||
  fail "Discord update worker logs disclosed its token"

echo "Exercising Discord control-plane graceful shutdown."
"${compose[@]}" stop --timeout 15 discord-bot discord-update-worker
[[ "$(docker inspect "${project_name}-discord-bot-1" --format '{{.State.ExitCode}}')" == "0" ]] ||
  fail "Discord bot did not exit cleanly after SIGTERM"
[[ "$(docker inspect "${project_name}-discord-update-worker-1" --format '{{.State.ExitCode}}')" == "0" ]] ||
  fail "Discord update scheduler did not exit cleanly after SIGTERM"
"${compose[@]}" start discord-bot discord-update-worker
"${compose[@]}" up --detach --wait discord-bot discord-update-worker

"${compose[@]}" exec --no-TTY app sh -c '
  test "$(id -u)" -ne 0
  ! touch /app/runtime-write-check 2>/dev/null
  touch /tmp/runtime-write-check
  rm /tmp/runtime-write-check
'

migration_count_before_restart="$(
  database_query 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'
)"
"${compose[@]}" restart app
wait_for_status "http://127.0.0.1:${app_port}/api/ready" "200"
migration_count_after_restart="$(
  database_query 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'
)"
[[ "${migration_count_before_restart}" == "${migration_count_after_restart}" ]] ||
  fail "application restart changed migration history"

echo "Proving the database survives a service restart."
"${compose[@]}" stop db
"${compose[@]}" start db
"${compose[@]}" up --detach --wait db
migration_count_after_database_restart="$(
  database_query 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'
)"
[[ "${migration_count_before_restart}" == "${migration_count_after_database_restart}" ]] ||
  fail "database service restart lost persisted migrations"

echo "Exercising an occupied host-port failure."
set +e
occupied_port_output="$(
  docker run --name "${occupied_port_container}" \
    --publish "127.0.0.1:${app_port}:3000" \
    --env NEXT_PUBLIC_APP_ENV=local \
    --env DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused \
    "${app_image}" 2>&1
)"
occupied_port_status=$?
set -e
((occupied_port_status != 0)) ||
  fail "a second container unexpectedly acquired the occupied application port"
[[ "${occupied_port_output}" == *"address already in use"* ||
  "${occupied_port_output}" == *"port is already allocated"* ]] ||
  fail "occupied-port failure was not actionable"

echo "Exercising unavailable-database readiness and graceful shutdown."
docker run --detach --name "${unavailable_database_container}" \
  --publish "127.0.0.1:${unavailable_database_port}:3000" \
  --env NEXT_PUBLIC_APP_ENV=local \
  --env DATABASE_URL=postgresql://smoke:synthetic-unavailable-secret@127.0.0.1:1/unavailable \
  "${app_image}" >/dev/null
wait_for_status "http://127.0.0.1:${unavailable_database_port}/api/health" "200"
wait_for_status "http://127.0.0.1:${unavailable_database_port}/api/ready" "503"
unavailable_logs="$(docker logs "${unavailable_database_container}" 2>&1)"
[[ "${unavailable_logs}" == *"Starting Baseball Stat Track"* ]] ||
  fail "startup was not logged to standard output"
[[ "${unavailable_logs}" != *"synthetic-unavailable-secret"* ]] ||
  fail "unavailable-database logs disclosed a password"
docker stop --time 15 "${unavailable_database_container}" >/dev/null
[[ "$(docker inspect "${unavailable_database_container}" --format '{{.State.ExitCode}}')" == "0" ]] ||
  fail "production container did not exit cleanly after SIGTERM"

echo "Resetting local data explicitly and rebuilding schema."
"${compose[@]}" down --volumes
"${compose[@]}" up --detach --wait db
[[ "$(database_query "SELECT to_regclass('public.\"_prisma_migrations\"') IS NULL;")" == "t" ]] ||
  fail "volume reset did not remove the local schema"
"${compose[@]}" up --detach --wait app
wait_for_status "http://127.0.0.1:${app_port}/api/ready" "200"

compose_logs="$("${compose[@]}" logs --no-color)"
[[ "${compose_logs}" == *"Starting Baseball Stat Track"* ]] ||
  fail "application startup log was not available through Compose"
[[ "${compose_logs}" != *"${POSTGRES_PASSWORD}"* ]] ||
  fail "Compose service logs disclosed the database password"

echo "Container smoke test passed."
