#!/usr/bin/env bash

set -uo pipefail

storage_path="${DB_STORAGE_PATH:-/var/lib/postgresql/data}"
volume_name="${DB_STORAGE_VOLUME_NAME:-postgres-production-data}"
warning_percent="${DB_STORAGE_WARNING_PERCENT:-70}"
critical_percent="${DB_STORAGE_CRITICAL_PERCENT:-75}"

unknown() {
  printf '%s\n\n' "Database Storage Health"
  printf 'Volume:\n%s\n\n' "${volume_name}"
  printf 'Status:\n%s\n\n' "Unknown"
  printf '%s\n' "Action:" \
    "Inspect check configuration and the database host or provider metric; filesystem information was unavailable."
  exit 3
}

if [[ ! "${volume_name}" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  volume_name="invalid-volume-label"
  unknown
fi

if [[ ! "${warning_percent}" =~ ^(0|[1-9][0-9]*)$ ]] ||
  [[ ! "${critical_percent}" =~ ^(0|[1-9][0-9]*)$ ]] ||
  ((warning_percent < 1 || warning_percent > 70)) ||
  ((critical_percent < 2 || critical_percent > 75)) ||
  ((warning_percent >= critical_percent)); then
  printf '%s\n' \
    "Database storage thresholds must be integers with warning <= 70, critical <= 75, and warning < critical." >&2
  unknown
fi

if ! command -v df >/dev/null 2>&1 || ! command -v awk >/dev/null 2>&1; then
  unknown
fi

if ! filesystem_line="$(df -Pk "${storage_path}" 2>/dev/null | awk 'END { print }')"; then
  unknown
fi

read -r _filesystem total_kib used_kib _available_kib usage_field _mountpoint <<<"${filesystem_line}"
usage_percent="${usage_field%%%}"

if [[ ! "${total_kib:-}" =~ ^[0-9]+$ ]] ||
  [[ ! "${used_kib:-}" =~ ^[0-9]+$ ]] ||
  [[ ! "${usage_percent:-}" =~ ^[0-9]+$ ]] ||
  ((total_kib == 0 || usage_percent > 100)); then
  unknown
fi

format_gib() {
  awk -v kib="$1" 'BEGIN { printf "%.2f GiB", kib / 1048576 }'
}

if ((usage_percent > critical_percent)); then
  status="Critical"
  action="Increase storage capacity before continuing normal operations. Investigate unexpected growth and remove retained operational data only when policy permits."
  exit_code=2
elif ((usage_percent >= warning_percent)); then
  status="Warning"
  action="Review growth, backups, retention, and logs; plan storage expansion before usage reaches the critical threshold."
  exit_code=1
else
  status="Healthy"
  action="Normal operation; continue monitoring database and host storage growth."
  exit_code=0
fi

printf '%s\n\n' "Database Storage Health"
printf 'Volume:\n%s\n\n' "${volume_name}"
printf 'Capacity:\n%s\n\n' "$(format_gib "${total_kib}")"
printf 'Used:\n%s\n\n' "$(format_gib "${used_kib}")"
printf 'Usage:\n%s%%\n\n' "${usage_percent}"
printf 'Status:\n%s\n\n' "${status}"
printf 'Action:\n%s\n\n' "${action}"
printf 'Metric:\ndatabase_storage_usage_percent %s\n' "${usage_percent}"

exit "${exit_code}"
