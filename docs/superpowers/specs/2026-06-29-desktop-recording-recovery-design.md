# Desktop recording recovery

## Problem

A recording made in the browser is buffered client-side in IndexedDB
(`janus-recording-drafts`, draft id `active-mobile-recording`) and only reaches
the server when the user finishes the review screen and saves. If the browser or
laptop closes before that save, the audio survives in IndexedDB but is only
recoverable through the **mobile** record view (`MRecordView`), which renders a
recovery panel when it detects an interrupted draft on mount.

Desktop users have no way to recover such a draft short of shrinking the window
below 640px to force the mobile layout. This adds recovery to the desktop view.

## Scope

Recovery only. No live microphone recording is added to the desktop beyond what
`UploadModal` already supports. The feature detects an interrupted draft and lets
the user review and save it through the existing desktop save path.

## Design

### 1. Detection hook — `useActiveRecordingDraft(currentUserId)`

New hook in `frontend/src/lib/`. Returns `{ draft, loading, refresh }`.

- On mount, calls `getActiveRecordingDraft()`.
- Surfaces the draft only when `draft.ownerUserId === currentUserId`; a draft
  owned by a different user is treated as absent (mirrors `record-view.tsx`).
- `refresh()` re-reads the draft. Called after a discard and after a successful
  recovery save so the banner clears.

### 2. Recovery banner — in `DesktopScribe` (`frontend/src/pages/scribe.tsx`)

Rendered at the top of the scribe page only when `draft` is present.

- Copy: `Unsaved recording — {mm:ss}, started {time}` using `draft.elapsedSeconds`
  and `draft.startedAt`.
- **Discard** → `deleteActiveRecordingDraft()` → `refresh()`.
- **Recover** → `buildRecordingDraftBlob(draft.draftId, draft.mimeType)` →
  wrap the blob in a `File` (`recovered-recording.{draft.fileExtension}`) →
  open `UploadModal` pre-filled with the recovered audio and the draft metadata.
  If the rebuilt blob is empty, show an error and leave the draft in place.

### 3. `UploadModal` pre-fill props (`frontend/src/components/scribe/upload-modal.tsx`)

New optional props:

- `initialAudioFile?: File | null`
- `initialDepartmentId?: string`
- `initialAppointmentId?: string`
- `initialAutoTranscribe?: boolean`
- `extraAppointment?: ScribeAppointment` — injected into the appointment options
  so the draft's appointment is selectable even when it is not in today's list
  (the problem `record-view.tsx` solves with `recoveredAppointment`).
- `onRecoverySaved?: () => void` — invoked after a successful save when opened in
  recovery mode, so the caller deletes the draft and refreshes the banner.

When opened with `initialAudioFile`:

- `encounterSource = "record"`, `recordingState = "recorded"`.
- Populate `file`, build `recordingUrl` from the file, and pre-select
  `departmentId` / `appointmentId` / `autoTranscribe` from the initial props.
- The user reviews and clicks the existing **Save** button; the existing
  `createSession` + `uploadAudio` path runs unchanged.

## Behavior notes

- **No appointment in draft.** If recording started before an appointment was
  picked, `initialAppointmentId` is empty. The banner still recovers the audio;
  the user selects the patient in the modal before saving. The modal already
  requires `appointmentId` to enable Save.
- **Non-destructive discovery.** The banner never starts a recording, so viewing
  or opening it cannot wipe the draft. (On mobile, navigating to record and
  starting a new recording wipes the existing draft.)
- **Draft cleanup.** The draft is deleted only on explicit Discard or on a
  successful recovery save. A cancelled modal leaves the draft intact.

## Out of scope

- Live microphone recording on desktop (separate from the existing
  `UploadModal` browser-record feature).
- Changes to the mobile recovery flow.
- Multiple concurrent drafts (the store holds a single
  `active-mobile-recording` draft).
