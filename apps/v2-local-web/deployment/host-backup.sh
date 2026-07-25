#!/usr/bin/env bash
set -euo pipefail

readonly backup_dir=/var/backups/astro-console
readonly origin_container=astro-console-origin
readonly state_path=/var/lib/astro-console/state.sqlite
readonly stage_path=/var/lib/astro-console/backup-stage.sqlite
readonly retention_days=14
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly target_path="${backup_dir}/state-${stamp}.sqlite"
readonly staged_target_path="${target_path}.partial"
readonly staged_checksum_path="${target_path}.sha256.partial"

cleanup() {
  docker exec "${origin_container}" rm -f "${stage_path}" || true
}
trap cleanup EXIT

install -d -m 0700 -o root -g root "${backup_dir}"
docker exec "${origin_container}" node --experimental-strip-types scripts/backup-preflight.ts backup "${state_path}" "${stage_path}"
docker exec "${origin_container}" node --experimental-strip-types scripts/backup-preflight.ts verify "${stage_path}"
docker cp "${origin_container}:${stage_path}" "${staged_target_path}"
sha256sum "${staged_target_path}" > "${staged_checksum_path}"
mv "${staged_target_path}" "${target_path}"
mv "${staged_checksum_path}" "${target_path}.sha256"
find "${backup_dir}" -maxdepth 1 -type f \( -name 'state-*.sqlite' -o -name 'state-*.sqlite.sha256' \) -mtime +"${retention_days}" -delete
