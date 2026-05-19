# Mobile Recording Resilience — Short-Term Design

## Context

Doctors may record mobile web scribe sessions for 60+ minutes. A recent long mobile recording stopped around 10 minutes and the app returned to the login screen. The current mobile recorder in `frontend/src/components/scribe-mobile/record-view.tsx` uses `MediaRecorder`, accumulates chunks in React memory, and only creates the uploadable `File` after `recorder.stop()`. A refresh, tab termination, auth redirect, or browser suspension can lose the entire recording.

Local config currently has `JWT_EXPIRY=8h` in `.env` and `.env.example`, so a 10-minute login redirect is likely either a production override, a 401 from another request, or mobile browser reload behavior rather than the repository default.

## Goals

1. Reduce risk of losing long recordings on mobile web without forcing wake lock usage.
2. Preserve recording chunks locally during recording so a refresh/reload can recover most audio.
3. Avoid extra battery drain from keeping the screen awake by default.
4. Keep the short-term fix frontend-only if possible, minimizing backend and deployment risk.
5. Preserve existing save/upload behavior for completed recordings.

## Non-goals

- True background/screen-off recording. Mobile browsers cannot guarantee this reliably; that remains a native/Capacitor app concern.
- Real-time server-side streaming/chunk assembly. This is a larger backend change and can follow later if needed.
- Wake lock by default.
- Changing authentication policy beyond documenting and verifying production `JWT_EXPIRY`.

## Existing behavior

- Mobile recording starts from `MRecordView.startRecording()`.
- Audio chunks are pushed into `chunksRef.current` from `recorder.ondataavailable`.
- `recorder.start()` is called without a timeslice, so browsers may not emit usable chunks until stop.
- On stop, chunks are converted into a Blob/File, preview URL is created, and phase moves to `review`.
- Save creates a scribe session, uploads the final file, and optionally starts transcription.
- Any API 401 clears the token and redirects to `/login` from `frontend/src/lib/api.ts`.

## Proposed short-term approach

### 1. Emit periodic recorder chunks

Call `recorder.start(RECORDING_CHUNK_MS)` with a modest timeslice, e.g. 10 seconds.

Benefits:
- Chunks become available during long recordings instead of only at the end.
- The maximum unrecoverable tail after a hard refresh is bounded to roughly the chunk interval.

Trade-off:
- Slightly more JS/IndexedDB writes, but far less costly than a wake lock.

### 2. Persist in-progress chunks to IndexedDB

Add a small frontend utility, e.g. `frontend/src/lib/recording-drafts.ts`, that stores one active mobile recording draft:

- metadata: draft id, mime type, file extension, patient id, department id, auto-transcribe setting, started timestamp, updated timestamp, elapsed seconds
- chunks: ordered Blob chunks by index

Storage model:
- IndexedDB database: `janus-recording-drafts`
- Object store: `chunks`, keyed by `[draftId, index]`
- Object store: `metadata`, keyed by `draftId`
- Keep only one active draft for MVP to avoid building a recording library.

Security/privacy note:
- This stores PHI-bearing audio locally in browser storage until saved or discarded.
- Each local draft metadata record is bound to the authenticated user id; recovery UI is only shown when the draft owner matches the current user, and mismatched or ownerless active drafts are deleted/hidden.
- Explicit logout attempts to clear the active local draft without blocking logout.
- Add UI copy explaining that an interrupted recording is temporarily stored on this device and should be saved or discarded.
- Delete the draft after successful save or explicit discard.

### 3. Recover draft on mobile record view load

When `MRecordView` mounts, check for an active draft. If one exists:

- Show an interruption/recovery panel before idle controls.
- Actions:
  - `Recover recording`: reconstruct Blob/File from stored chunks, restore patient/department/auto-transcribe fields, create object URL, move to `review`.
  - `Discard`: delete draft and return to idle.

This handles both completed-but-unsaved and mid-recording interrupted drafts. Mid-recording recovery will contain chunks emitted before the interruption.

### 4. Keep auth redirect behavior unchanged for now, but verify config

No code auth changes in this short-term pass unless a production `JWT_EXPIRY` override is found. We should verify deployed env has `JWT_EXPIRY=8h` or longer.

Reasoning:
- Silent refresh requires new auth endpoints/token lifecycle design.
- Local default is already 8h.
- Durable local recording protects against auth redirects by preserving chunks before login.

### 5. No wake lock by default

Do not enable wake lock in this pass. We may later add an optional, doctor-controlled “Keep screen awake” toggle with dark/low-power UI.

## UX details

### Idle state with no draft

Same as today.

### Draft found state

Display a compact card:

> Interrupted recording found
> We saved audio from a previous recording on this device. Review and save it, or discard it.

Buttons:
- `Recover recording`
- `Discard`

### Recording state

Add subtle reassurance text:

> Recording is being saved locally as you go. Keep this page open for best results.

### Review state for recovered draft

Existing review UI, plus optional note:

> Recovered from local device storage. Please review before saving.

## Error handling

- If IndexedDB is unavailable or a write fails, recording should continue using current in-memory behavior and show a non-blocking warning.
- If draft recovery fails, show an error and offer discard.
- If upload succeeds, delete the local draft.
- If upload fails, keep the draft and remain in review so the doctor can retry.

## Testing plan

Frontend unit tests:
- Recording draft utility can save metadata/chunks, list active draft, reconstruct ordered blob, and delete draft.
- `MRecordView` shows recovery UI when a draft exists.
- Recover action restores review flow enough to save.

Manual testing:
1. Start mobile recording, wait for at least one chunk interval, refresh page, confirm recovery UI appears.
2. Recover and save recording successfully.
3. Discard recovered recording and confirm it does not reappear.
4. Simulate IndexedDB unavailable/write failure and confirm recording still works.
5. Run `cd frontend && npm run build`.

## Future follow-up options

- Server-side chunk upload and assembly for stronger durability across browser storage eviction.
- Refresh token/silent re-auth to avoid login redirects during long workflows.
- Optional wake lock toggle with low-power screen.
- Native or Capacitor app for reliable screen-off/background recording.
