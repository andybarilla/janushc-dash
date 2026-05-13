# Recording ingest from shared Google Drive

This process lets the deployed server pull audio files from the shared Google Drive folder `Sample Recordings`, run AWS Transcribe Medical, and import the generated transcripts into JanusHC.

## Flow

1. `rclone copy --drive-shared-with-me gdrive:"Sample Recordings" recordings/inbox`
2. Run `/usr/local/bin/batch-transcribe-recordings` in the production app image.
3. Run `/usr/local/bin/import-transcripts` in the production app image.
4. Optionally mirror the staged raw recordings to an `jcaws` rclone archive.

The steps are idempotent: existing local files are not re-downloaded unnecessarily, existing transcript files are skipped unless `TRANSCRIBE_ARGS='-overwrite'` is set, and existing imported encounters are skipped unless `IMPORT_ARGS='-overwrite'` is set.

## One-time server setup

Install rclone on the server and configure/copy the remotes:

```bash
sudo apt-get update
sudo apt-get install -y rclone util-linux
mkdir -p ~/.config/rclone
chmod 700 ~/.config/rclone
# Copy the relevant gdrive/jcaws entries from your local rclone.conf, then:
chmod 600 ~/.config/rclone/rclone.conf
```

For the shared Drive folder, verify the remote can see files shared with you:

```bash
rclone lsf --drive-shared-with-me gdrive:"Sample Recordings"
```

If the server is headless and you do not want to copy your local config, run `rclone config` on the server and use rclone's browserless OAuth flow (`rclone authorize "drive"` from your local machine) to create the `gdrive` remote.

Ensure `.env` on the server has the normal production settings plus AWS settings used by the worker commands:

```dotenv
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_TRANSCRIBE_BUCKET=...
AWS_BEDROCK_MODEL_ID=...
DATABASE_URL=postgres://...@postgres:5432/...?sslmode=disable
```

Rebuild/restart the production image after deploying this change so the utility binaries are present:

```bash
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml up -d
```

## Manual run

From the repo directory on the server:

```bash
# Preview what rclone would copy.
SYNC_DRY_RUN=true scripts/sync-sample-recordings.sh

# Pull recordings, transcribe, and import.
scripts/sync-sample-recordings.sh
```

Useful overrides:

```bash
GDRIVE_REMOTE=gdrive \
GDRIVE_RECORDINGS_PATH='Sample Recordings' \
RECORDINGS_INBOX=/srv/janushc-dash/recordings/inbox \
TRANSCRIPTS_DIR=/srv/janushc-dash/tmp/transcripts \
scripts/sync-sample-recordings.sh
```

Optional `jcaws` archive mirror after successful ingest:

```bash
JCAWS_ARCHIVE_REMOTE=jcaws \
JCAWS_ARCHIVE_PATH='janushc/recordings/raw' \
scripts/sync-sample-recordings.sh
```

## Scheduled run with systemd

The sample unit assumes the deployed repo lives at `/srv/janushc-dash`. Adjust paths if needed.

```bash
sudo cp deploy/systemd/janushc-recording-ingest.service /etc/systemd/system/
sudo cp deploy/systemd/janushc-recording-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now janushc-recording-ingest.timer

# Run immediately and inspect logs.
sudo systemctl start janushc-recording-ingest.service
journalctl -u janushc-recording-ingest.service -n 100 --no-pager
```
