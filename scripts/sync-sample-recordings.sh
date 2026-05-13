#!/usr/bin/env bash
set -euo pipefail

# Pull recordings from the shared Google Drive folder into the deployed app's
# local staging directory, then optionally transcribe and import them.
#
# Required on the host:
#   - rclone configured with a Google Drive remote that can see the shared folder
#   - Docker Compose access to the deployed janushc-dash stack
#   - AWS/database settings in .env for the one-off worker containers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-api}"

GDRIVE_REMOTE="${GDRIVE_REMOTE:-gdrive}"
GDRIVE_RECORDINGS_PATH="${GDRIVE_RECORDINGS_PATH:-Sample Recordings}"
GDRIVE_SHARED_WITH_ME="${GDRIVE_SHARED_WITH_ME:-true}"

abs_project_path() {
  local path="$1"
  if [[ "$path" == /* ]]; then
    printf '%s' "$path"
  else
    printf '%s/%s' "$PROJECT_DIR" "$path"
  fi
}

RECORDINGS_INBOX="$(abs_project_path "${RECORDINGS_INBOX:-recordings/inbox}")"
TRANSCRIPTS_DIR="$(abs_project_path "${TRANSCRIPTS_DIR:-tmp/transcripts}")"
LOCK_FILE="$(abs_project_path "${LOCK_FILE:-tmp/recording-ingest.lock}")"

RUN_TRANSCRIBE="${RUN_TRANSCRIBE:-true}"
RUN_IMPORT="${RUN_IMPORT:-true}"
SYNC_DRY_RUN="${SYNC_DRY_RUN:-false}"

# Extra args are intentionally split by the shell so operators can pass flags,
# e.g. TRANSCRIBE_ARGS='-overwrite -timeout 3h'.
TRANSCRIBE_ARGS="${TRANSCRIBE_ARGS:-}"
IMPORT_ARGS="${IMPORT_ARGS:-}"
RCLONE_EXTRA_FLAGS="${RCLONE_EXTRA_FLAGS:-}"

# Optional archive mirror after a successful run. Example:
#   JCAWS_ARCHIVE_REMOTE=jcaws JCAWS_ARCHIVE_PATH='janushc/recordings/raw'
JCAWS_ARCHIVE_REMOTE="${JCAWS_ARCHIVE_REMOTE:-}"
JCAWS_ARCHIVE_PATH="${JCAWS_ARCHIVE_PATH:-}"

bool_true() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

compose() {
  if [[ -n "${COMPOSE_COMMAND:-}" ]]; then
    # shellcheck disable=SC2086
    $COMPOSE_COMMAND -f "$COMPOSE_FILE" "$@"
  elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v podman-compose >/dev/null 2>&1; then
    podman-compose -f "$COMPOSE_FILE" "$@"
  else
    echo "docker compose or podman-compose is required" >&2
    exit 1
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required" >&2
    exit 1
  fi
}

remote_path() {
  local remote="${1%:}"
  local path="${2#/}"
  printf '%s:%s' "$remote" "$path"
}

main() {
  require_cmd rclone
  require_cmd flock
  mkdir -p "$RECORDINGS_INBOX" "$TRANSCRIPTS_DIR" "$(dirname "$LOCK_FILE")"

  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "another recording ingest is already running ($LOCK_FILE)" >&2
    exit 0
  fi

  cd "$PROJECT_DIR"

  local source
  source="$(remote_path "$GDRIVE_REMOTE" "$GDRIVE_RECORDINGS_PATH")"

  local rclone_flags=(copy "$source" "$RECORDINGS_INBOX" --create-empty-src-dirs --fast-list)
  if bool_true "$GDRIVE_SHARED_WITH_ME"; then
    rclone_flags+=(--drive-shared-with-me)
  fi
  if bool_true "$SYNC_DRY_RUN"; then
    rclone_flags+=(--dry-run)
  fi

  echo "Syncing recordings: $source -> $RECORDINGS_INBOX"
  # shellcheck disable=SC2086
  rclone "${rclone_flags[@]}" $RCLONE_EXTRA_FLAGS

  if bool_true "$SYNC_DRY_RUN"; then
    echo "Dry run requested; skipping transcription/import."
    return 0
  fi

  if bool_true "$RUN_TRANSCRIBE"; then
    echo "Running AWS batch transcription for staged recordings"
    # shellcheck disable=SC2086
    compose run --rm --no-deps \
      -v "$RECORDINGS_INBOX:/app/recordings/inbox:ro" \
      -v "$TRANSCRIPTS_DIR:/app/tmp/transcripts" \
      "$COMPOSE_SERVICE" \
      /usr/local/bin/batch-transcribe-recordings \
        -input /app/recordings/inbox \
        -out /app/tmp/transcripts \
        $TRANSCRIBE_ARGS
  fi

  if bool_true "$RUN_IMPORT"; then
    echo "Importing transcripts into JanusHC"
    compose up -d postgres
    # shellcheck disable=SC2086
    compose run --rm \
      -v "$TRANSCRIPTS_DIR:/app/tmp/transcripts:ro" \
      "$COMPOSE_SERVICE" \
      /usr/local/bin/import-transcripts \
        -input /app/tmp/transcripts \
        $IMPORT_ARGS
  fi

  if [[ -n "$JCAWS_ARCHIVE_REMOTE" && -n "$JCAWS_ARCHIVE_PATH" ]]; then
    local archive_dest
    archive_dest="$(remote_path "$JCAWS_ARCHIVE_REMOTE" "$JCAWS_ARCHIVE_PATH")"
    echo "Mirroring staged recordings to archive: $archive_dest"
    # shellcheck disable=SC2086
    rclone copy "$RECORDINGS_INBOX" "$archive_dest" --fast-list $RCLONE_EXTRA_FLAGS
  fi
}

main "$@"
