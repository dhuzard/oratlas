#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 --project PROJECT --instance INSTANCE --build-id BUILD_ID --output PATH" >&2
  exit 2
}

project_id=""
instance_id=""
build_id=""
output_path=""

while (($# > 0)); do
  case "$1" in
    --project)
      (($# >= 2)) || usage
      project_id="$2"
      shift 2
      ;;
    --instance)
      (($# >= 2)) || usage
      instance_id="$2"
      shift 2
      ;;
    --build-id)
      (($# >= 2)) || usage
      build_id="$2"
      shift 2
      ;;
    --output)
      (($# >= 2)) || usage
      output_path="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ -n "$project_id" && -n "$instance_id" && -n "$build_id" && -n "$output_path" ]] || usage
[[ "$project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || {
  echo "Invalid Google Cloud project id." >&2
  exit 2
}
[[ "$instance_id" =~ ^[a-z]([a-z0-9-]{0,96}[a-z0-9])?$ ]] || {
  echo "Invalid Cloud SQL instance id." >&2
  exit 2
}
[[ "$build_id" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "Invalid Cloud Build id." >&2
  exit 2
}

gcloud_bin="${GCLOUD_BIN:-gcloud}"
command -v "$gcloud_bin" >/dev/null 2>&1 || {
  echo "gcloud is required for the Cloud SQL backup gate." >&2
  exit 1
}

configuration=$("$gcloud_bin" sql instances describe "$instance_id" \
  --project="$project_id" \
  --format='csv[no-heading](settings.backupConfiguration.enabled,settings.backupConfiguration.pointInTimeRecoveryEnabled)')
IFS=',' read -r backups_enabled pitr_enabled extra <<<"$configuration"

backups_enabled=$(printf '%s' "$backups_enabled" | tr '[:upper:]' '[:lower:]')
pitr_enabled=$(printf '%s' "$pitr_enabled" | tr '[:upper:]' '[:lower:]')
if [[ "$backups_enabled" != "true" || "$pitr_enabled" != "true" || -n "${extra:-}" ]]; then
  echo "Refusing migration: scheduled backups and point-in-time recovery must both be enabled." >&2
  exit 1
fi

description="oratlas-pre-migration-${build_id}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
echo "Creating synchronous Cloud SQL backup: ${description}"
"$gcloud_bin" sql backups create \
  --project="$project_id" \
  --instance="$instance_id" \
  --description="$description" \
  --quiet

backup_id=$("$gcloud_bin" sql backups list \
  --project="$project_id" \
  --instance="$instance_id" \
  --filter="description=${description}" \
  --sort-by='~endTime' \
  --limit=1 \
  --format='value(id)')
backup_id=$(printf '%s' "$backup_id" | tr -d '\r\n')
[[ -n "$backup_id" ]] || {
  echo "Refusing migration: the newly created backup could not be identified." >&2
  exit 1
}
[[ "$backup_id" =~ ^[A-Za-z0-9._/-]{1,300}$ ]] || {
  echo "Refusing migration: the returned backup id contains unsafe characters." >&2
  exit 1
}

backup_record=$("$gcloud_bin" sql backups describe "$backup_id" \
  --project="$project_id" \
  --instance="$instance_id" \
  --format='csv[no-heading](id,status,description)')
IFS=',' read -r verified_id backup_status verified_description extra <<<"$backup_record"
if [[ "$verified_id" != "$backup_id" || "$backup_status" != "SUCCESSFUL" || \
  "$verified_description" != "$description" || -n "${extra:-}" ]]; then
  echo "Refusing migration: backup ${backup_id} was not verified as the requested SUCCESSFUL backup." >&2
  exit 1
fi

umask 077
printf '%s\n' "$backup_id" >"${output_path}.tmp"
mv "${output_path}.tmp" "$output_path"
echo "Verified Cloud SQL backup ${backup_id}; migration gate recorded at ${output_path}."
