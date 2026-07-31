#!/usr/bin/env bash

set -Eeuo pipefail

project_name="bst-container-$$_${RANDOM}"
app_image="${project_name}-app:local"
migration_image="${project_name}-migration:local"
discord_bot_image="${project_name}-discord-bot:local"
app_port="$((32000 + ($$ % 1000)))"
unavailable_database_port="$((36000 + ($$ % 1000)))"
unavailable_database_container="${project_name}-unavailable-database"
occupied_port_container="${project_name}-occupied-port"
compose=(docker compose --project-name "${project_name}")

export APP_IMAGE="${app_image}"
export MIGRATION_IMAGE="${migration_image}"
export DISCORD_BOT_IMAGE="${discord_bot_image}"
export IMAGE_PULL_POLICY=never
export APP_PORT="${app_port}"
export POSTGRES_DB=baseballstattrack_smoke
export POSTGRES_USER=baseballstattrack_smoke
export POSTGRES_PASSWORD=synthetic-container-smoke-only
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public"
export DIRECT_URL="${DATABASE_URL}"
export NEXT_PUBLIC_SITE_URL=https://app.example.test
export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-public-anonymous-key
export SUPABASE_OAUTH_PROVIDER=google
export WEBHOOK_SIGNING_MASTER_KEY=synthetic_webhook_signing_master_key_1234567890
export WEBHOOK_WORKER_TOKEN=synthetic-webhook-worker-token-1234567890
export EXTERNAL_INGESTION_WORKER_TOKEN=synthetic-ingestion-worker-token-1234567890
export EXTERNAL_DATA_PROVIDER_BASE_URL=https://provider.example.test
export EXTERNAL_DATA_PROVIDER_API_KEY=synthetic-provider-api-key
export DISCORD_TOKEN=synthetic-discord-token-long-enough-for-validation
export BST_API_TOKEN=synthetic-api-token-long-enough-for-validation
export BST_API_BASE_URL=https://app.example.test
export BST_WEB_BASE_URL=https://app.example.test
export DISCORD_TEAM_BINDINGS='[{"guildId":"100","accountId":"00000000-0000-4000-8000-000000000001","teamId":"00000000-0000-4000-8000-000000000002","channelIds":["200"],"roleIds":["300"]}]'
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
    "${migration_image}" >/dev/null 2>&1 || true

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
  const required = ["/app/server.js", "/app/.next/static", "/app/public", "/app/container/start.mjs"];
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
