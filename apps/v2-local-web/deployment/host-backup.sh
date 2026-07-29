#!/usr/bin/env bash
set -euo pipefail

readonly backup_dir=/mnt/storage/astro-console/backups
readonly origin_container=astro-console-origin
readonly state_path=/var/lib/astro-console/state.sqlite
readonly stage_path=/var/lib/astro-console/backup-stage.sqlite
readonly restore_source_path=/var/lib/astro-console/backup-restore-source.sqlite
readonly restore_drill_path=/var/lib/astro-console/backup-restore-drill.sqlite
readonly retention_days=14
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly target_path="${backup_dir}/state-${stamp}.sqlite"
readonly staged_target_path="${target_path}.partial"
readonly staged_checksum_path="${target_path}.sha256.partial"
complete=0

cleanup() {
  docker exec "${origin_container}" rm -f "${stage_path}" "${restore_source_path}" "${restore_drill_path}" || true
  [[ "${complete}" == 1 ]] || rm -f "${staged_target_path}" "${staged_checksum_path}" "${target_path}" "${target_path}.sha256"
}
trap cleanup EXIT

install -d -m 0700 -o root -g root "${backup_dir}"
[[ "$(docker exec "${origin_container}" stat -c %d "${state_path}")" != "$(stat -c %d "${backup_dir}")" ]] || { echo "Backup destination must be on a different filesystem than live SQLite" >&2; exit 1; }
docker exec "${origin_container}" node --experimental-strip-types scripts/backup-preflight.ts backup "${state_path}" "${stage_path}"
stage_checksum="$(docker exec "${origin_container}" sha256sum "${stage_path}" | awk '{print $1}')"
docker cp "${origin_container}:${stage_path}" "${staged_target_path}"
[[ "${stage_checksum}" == "$(sha256sum "${staged_target_path}" | awk '{print $1}')" ]] || { echo "SSD backup copy checksum mismatch" >&2; exit 1; }
mv "${staged_target_path}" "${target_path}"
final_checksum="$(sha256sum "${target_path}" | awk '{print $1}')"
[[ "${stage_checksum}" == "${final_checksum}" ]] || { echo "Promoted SSD backup checksum mismatch" >&2; exit 1; }
printf '%s  %s\n' "${final_checksum}" "$(basename "${target_path}")" > "${staged_checksum_path}"
mv "${staged_checksum_path}" "${target_path}.sha256"
sha256sum -c "${target_path}.sha256"
docker cp "${target_path}" "${origin_container}:${restore_source_path}"
docker exec "${origin_container}" node --experimental-strip-types scripts/backup-preflight.ts restore-drill "${restore_source_path}" "${restore_drill_path}"
find "${backup_dir}" -maxdepth 1 -type f \( -name 'state-*.sqlite' -o -name 'state-*.sqlite.sha256' \) -mtime +"${retention_days}" -delete
complete=1
printf 'backup=%s bytes=%s sha256=%s restore_drill=passed retention_days=%s destination=%s\n' "$(basename "${target_path}")" "$(stat -c %s "${target_path}")" "${final_checksum}" "${retention_days}" "${backup_dir}"
