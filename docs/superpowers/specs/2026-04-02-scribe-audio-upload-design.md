# Scribe Audio Upload & Transcription

Batch audio upload for the scribe pipeline. The doctor records a visit (phone or computer), uploads the audio file, and the system transcribes it via AWS Transcribe Medical, then feeds the transcript into the existing scribe processing pipeline.

This is the testing/MVP path — real-time streaming is deferred to a later phase.

## Flow

1. Doctor creates a scribe session (existing flow — patient ID, encounter ID, department ID)
2. Doctor uploads an audio file to that session
3. Server streams audio to AWS Transcribe Medical, collects transcript
4. Transcript feeds into existing `Processor.Process()` → structured AI output
5. `Processor.WriteToAthena()` pushes results to the EMR
6. Session updated to `complete` with transcript and AI output

## Backend

### New endpoint

`POST /api/scribe/sessions/:id/upload`

- Accepts `multipart/form-data` with a single `audio` file field
- Validation:
  - Session exists and belongs to tenant
  - Session status is not `complete`
  - File size ≤ 100 MB
  - File extension: `.mp3`, `.m4a`, `.wav`, `.webm`, `.ogg`
- Synchronous — streams audio to Transcribe, waits for transcript, runs AI pipeline, returns completed session as JSON
- Sets a 5-minute timeout on this endpoint specifically

### New package: `internal/transcribe/`

Thin wrapper around the AWS Transcribe Medical streaming SDK, following the same pattern as `internal/bedrock/`.

```go
type Client struct {
    client *transcribestreamingservice.Client
}

func (c *Client) Transcribe(ctx context.Context, audio io.Reader, mediaFormat types.MediaEncoding, sampleRate int32) (string, error)
```

- Streams audio to `StartMedicalStreamTranscription`
- Collects transcript text from response events
- Returns concatenated transcript string

### Config

Uses the existing `AWSRegion` config value. No new env vars needed beyond what's already configured for Bedrock.

### Wiring

- Create `transcribe.Client` in `main.go`
- Pass it to `scribe.Handler` — the handler calls transcribe, then passes the transcript string to the existing `Processor.Process()`
- Register the new upload route in `server.routes()`

### Format mapping

The handler maps file extensions to AWS `MediaEncoding` values:

- `.mp3` → `MediaEncodingMp3` (sample rate: 44100)
- `.m4a` → `MediaEncodingMp4a` (sample rate: 44100)
- `.wav` → `MediaEncodingPcm` (sample rate: 44100)
- `.webm` → `MediaEncodingOggOpus` (sample rate: 48000)
- `.ogg` → `MediaEncodingOggOpus` (sample rate: 48000)

## Frontend

Minimal changes to `frontend/src/pages/scribe.tsx`:

- Replace the transcript `<textarea>` with a file `<input accept=".mp3,.m4a,.wav,.webm,.ogg">`
- Submit sends `multipart/form-data` to the upload endpoint instead of JSON to the process endpoint
- Show a loading spinner while the request is in flight (can take 30-60s)
- Display results the same way as currently

### API client

Add a method or standalone function that sends `FormData` instead of JSON (the existing `fetch<T>()` assumes JSON bodies).

### New query hook

`useUploadScribeAudio()` — mutation that posts `FormData`, invalidates session list on success.

## Error Handling

- **Transcription failure:** Session status set to `error` with message. Return 500. Retry by re-uploading.
- **AI processing failure:** Same — session marked `error`. Transcript is saved, but for simplicity no separate retry path yet.
- **Athena write failure:** Existing `WriteToAthena` handles partial failures gracefully. Session still completes.
- **Bad audio (silence/garbled):** AWS Transcribe returns empty/minimal text. AI pipeline produces thin output. No special handling — the doctor sees the result and knows the recording was bad.

## Testing

- **Transcribe client:** Unit tests with a mock interface for the AWS SDK. Verify transcript assembly from streamed response events.
- **Upload handler:** Test multipart parsing, file validation (size, format), error cases (missing file, wrong format, oversized). Mock transcribe client and processor.
- **Integration:** Manual testing with real recordings against athenahealth sandbox.

## Audio Formats

| Format | Extension | Common source |
|--------|-----------|---------------|
| MP3 | `.mp3` | Universal |
| AAC | `.m4a` | iPhone voice memos |
| WAV | `.wav` | Desktop recording apps |
| WebM | `.webm` | Browser recording |
| OGG | `.ogg` | Browser recording |

## Out of Scope

- Real-time streaming / WebSocket recording (phase 2)
- Audio file persistence (S3 storage)
- Retry without re-upload
- Frontend tests
