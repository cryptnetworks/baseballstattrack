#!/usr/bin/env bash

set -Eeuo pipefail

command -v docker >/dev/null || {
  echo "Release rehearsal requires Docker." >&2
  exit 1
}
command -v git >/dev/null || {
  echo "Release rehearsal requires Git." >&2
  exit 1
}

project_name="bst-release-$$_${RANDOM}"
candidate_image="${project_name}-candidate:local"
migration_image="${project_name}-migration:local"
rollback_image="${project_name}-rollback:local"
app_port="$((37000 + ($$ % 1000)))"
rollback_revision="${ROLLBACK_REVISION:-HEAD^}"
rollback_directory="$(mktemp -d)"
compose=(docker compose --project-name "${project_name}")

export APP_ENV=local
export APP_IMAGE="${candidate_image}"
export MIGRATION_IMAGE="${migration_image}"
export APP_PORT="${app_port}"
export POSTGRES_DB=baseballstattrack_release_rehearsal
export POSTGRES_USER=release_rehearsal
export POSTGRES_PASSWORD=synthetic-release-rehearsal-only
export VCS_REF="$(git rev-parse HEAD)"

cleanup() {
  local exit_code=$?

  if ((exit_code != 0)); then
    echo "Release rehearsal failed; service logs follow." >&2
    "${compose[@]}" ps --all >&2 || true
    "${compose[@]}" logs --no-color >&2 || true
  fi

  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "${candidate_image}" "${migration_image}" "${rollback_image}" >/dev/null 2>&1 || true
  rm -rf "${rollback_directory}"
  exit "${exit_code}"
}

trap cleanup EXIT

fail() {
  echo "Release rehearsal failed: $*" >&2
  return 1
}

wait_for_ready() {
  local attempts=60
  local status

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
      "http://127.0.0.1:${app_port}/api/ready" || true)"
    [[ "${status}" == "200" ]] && return 0
    sleep 1
  done

  fail "application did not become ready"
}

git cat-file -e "${rollback_revision}^{commit}" 2>/dev/null ||
  fail "rollback revision ${rollback_revision} is unavailable; fetch at least two commits"

rollback_sha="$(git rev-parse "${rollback_revision}^{commit}")"
git archive "${rollback_sha}" | tar -x -C "${rollback_directory}"

echo "Building candidate and matching migration artifacts from ${VCS_REF}."
"${compose[@]}" build app migrate

echo "Building rollback artifact from ${rollback_sha}."
docker build \
  --target runtime \
  --build-arg "VCS_REF=${rollback_sha}" \
  --tag "${rollback_image}" \
  "${rollback_directory}"

candidate_label="$(docker image inspect "${candidate_image}" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
rollback_label="$(docker image inspect "${rollback_image}" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
[[ "${candidate_label}" == "${VCS_REF}" ]] || fail "candidate revision label is incorrect"
[[ "${rollback_label}" == "${rollback_sha}" ]] || fail "rollback revision label is incorrect"

echo "Applying candidate migrations and releasing the candidate."
"${compose[@]}" up --detach --wait db
"${compose[@]}" run --rm migrate
"${compose[@]}" up --detach app
wait_for_ready

migrations_before="$(
  "${compose[@]}" exec --no-TTY db \
    psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
    --tuples-only --no-align \
    --command 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'
)"
[[ "${migrations_before}" =~ ^[1-9][0-9]*$ ]] || fail "candidate migration evidence is missing"

echo "Rolling the application back without reverting immutable migrations."
export APP_IMAGE="${rollback_image}"
"${compose[@]}" up --detach --force-recreate app
wait_for_ready

migrations_after="$(
  "${compose[@]}" exec --no-TTY db \
    psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
    --tuples-only --no-align \
    --command 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'
)"
[[ "${migrations_after}" == "${migrations_before}" ]] || fail "application rollback changed migration history"

running_image="$(docker inspect "${project_name}-app-1" --format '{{.Config.Image}}')"
[[ "${running_image}" == "${rollback_image}" ]] || fail "rollback artifact is not running"

echo "Release rehearsal passed: candidate ${VCS_REF}, rollback ${rollback_sha}, ${migrations_after} migrations preserved."
