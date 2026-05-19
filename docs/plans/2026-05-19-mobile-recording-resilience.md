# Mobile Recording Resilience Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Make long mobile scribe recordings recoverable after refresh/interruption by periodically emitting and persisting audio chunks in IndexedDB.
**Architecture:** Add a frontend-only IndexedDB draft store for one active mobile recording. Update `MRecordView` to start `MediaRecorder` with a 10-second timeslice, write chunks/metadata as recording proceeds, offer recovery on mount, and delete drafts only after successful upload or explicit discard.
**Tech Stack:** React 19, TypeScript, Vitest/jsdom, Testing Library, browser MediaRecorder, IndexedDB.

---

## Scope

In scope:
- Frontend-only resilience for `frontend/src/components/scribe-mobile/record-view.tsx`.
- `MediaRecorder.start(10_000)` timeslice.
- IndexedDB metadata/chunk persistence utility.
- Recovery/discard UI on mobile record view load.
- Deletion after successful upload or explicit discard/re-record/back discard.
- Unit/component tests and frontend build verification.

Out of scope:
- Wake Lock API.
- Auth refresh/token lifecycle changes.
- Backend/server-side chunk upload or assembly.
- True background/screen-off recording guarantees.

## Files to Change

- Create `frontend/src/lib/recording-drafts.ts`
  - Owns IndexedDB schema `janus-recording-drafts`, stores `metadata` and `chunks`, exposes typed helpers for active draft lifecycle.
- Create `frontend/src/lib/recording-drafts.test.ts`
  - Tests IndexedDB utility with a fake in-memory IndexedDB implementation local to the test file.
- Modify `frontend/src/components/scribe-mobile/record-view.tsx`
  - Adds 10-second timeslice, draft creation/chunk persistence, recovery state/UI, discard/delete behavior, recovered-review note.
- Create `frontend/src/components/scribe-mobile/record-view.test.tsx`
  - Tests recovery UI and save/delete behavior with mocked draft utility and scribe mutations.
- Optionally modify `frontend/src/styles/janus-scribe-mobile.css`
  - Only if existing classes are insufficient. Prefer existing `.m-rec-detail`, `.m-rec-error`, `.m-record-secondary`, `.m-record-save` classes.

## Shared Implementation Constants

Use these exact values unless a test requires dependency injection:

```ts
export const RECORDING_CHUNK_MS = 10_000;
export const RECORDING_DRAFT_DATABASE_NAME = "janus-recording-drafts";
export const RECORDING_DRAFT_DATABASE_VERSION = 1;
export const ACTIVE_RECORDING_DRAFT_ID = "active-mobile-recording";
```

## Task 1: IndexedDB Recording Draft Utility

**Files:**
- Create: `frontend/src/lib/recording-drafts.ts`
- Create: `frontend/src/lib/recording-drafts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/lib/recording-drafts.test.ts`. Include tests that:
1. Save metadata and chunks out of order, then reconstruct an ordered Blob.
2. Return `null` when no active draft exists.
3. Delete metadata and chunks.
4. Treat unavailable IndexedDB as non-fatal by resolving `null`/no-op or rejecting only from write helpers that caller catches.

Run:
```bash
cd frontend && npm test -- src/lib/recording-drafts.test.ts
```
Expected: FAIL because `./recording-drafts` does not exist.

- [ ] **Step 2: Implement utility**

Create `frontend/src/lib/recording-drafts.ts` with explicit exported types:

```ts
export interface RecordingDraftMetadata {
  draftId: string;
  mimeType: string;
  fileExtension: string;
  patientId: string;
  departmentId: string;
  autoTranscribe: boolean;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  nextChunkIndex: number;
}

export interface RecordingDraftChunk {
  draftId: string;
  index: number;
  blob: Blob;
}
```

Expose these functions with typed parameters/returns:
- `createActiveRecordingDraft(input: Omit<RecordingDraftMetadata, "draftId" | "startedAt" | "updatedAt" | "nextChunkIndex">): Promise<RecordingDraftMetadata>`
- `getActiveRecordingDraft(): Promise<RecordingDraftMetadata | null>`
- `saveRecordingDraftChunk(draftId: string, index: number, blob: Blob): Promise<void>`
- `updateActiveRecordingDraftMetadata(patch: Pick<RecordingDraftMetadata, "elapsedSeconds" | "patientId" | "departmentId" | "autoTranscribe"> & { nextChunkIndex?: number }): Promise<void>`
- `buildRecordingDraftBlob(draftId: string, mimeType: string): Promise<Blob>`
- `deleteActiveRecordingDraft(): Promise<void>`

Implementation requirements:
- Use IndexedDB directly; do not add dependencies.
- Database: `janus-recording-drafts`, version `1`.
- Stores: `metadata` keyed by `draftId`; `chunks` keyed by `[draftId, index]` with index `draftId`.
- Keep MVP to one active draft id: `active-mobile-recording`.
- If `window.indexedDB` is missing, read helpers return `null`/empty Blob as appropriate and write helpers throw `Error("IndexedDB is not available")`; `MRecordView` will catch write failures and continue recording.
- Use imports at top only, strict types, no `any` except unavoidable IDB event casts; prefer `unknown` and narrow.

- [ ] **Step 3: Verify tests pass**

Run:
```bash
cd frontend && npm test -- src/lib/recording-drafts.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/recording-drafts.ts frontend/src/lib/recording-drafts.test.ts
git commit -m "Add local recording draft storage"
```

## Task 2: Persist Live Recording Chunks

**Files:**
- Modify: `frontend/src/components/scribe-mobile/record-view.tsx`
- Test: `frontend/src/components/scribe-mobile/record-view.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `frontend/src/components/scribe-mobile/record-view.test.tsx` using Testing Library and Vitest. Mock:
- `@/lib/scribe-queries` so `useCreateScribeSession` and `useUploadScribeAudio` return `mutateAsync` mocks.
- `@/lib/recording-drafts` so draft functions are observable.
- `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, `URL.createObjectURL`, `URL.revokeObjectURL`.

Tests for this task:
1. Clicking start calls `createActiveRecordingDraft` with patient, department, autoTranscribe, mime type/extension.
2. Fake `MediaRecorder.start` receives `10000`.
3. Firing `ondataavailable` with a non-empty Blob calls `saveRecordingDraftChunk("active-mobile-recording", 0, blob)` and increments subsequent chunk index.
4. If `saveRecordingDraftChunk` rejects, recording continues and shows warning text `Recording is continuing, but local recovery storage is unavailable.`

Run:
```bash
cd frontend && npm test -- src/components/scribe-mobile/record-view.test.tsx
```
Expected: FAIL because current component does not use draft storage or timeslice.

- [ ] **Step 2: Implement live persistence**

Modify `record-view.tsx`:
- Import draft helpers and `ACTIVE_RECORDING_DRAFT_ID`, `RECORDING_CHUNK_MS`.
- Add state `storageWarning: string | null`.
- Add refs `draftIdRef`, `nextChunkIndexRef`.
- In `startRecording`, after constructing recorder and before `recorder.start(...)`, call `createActiveRecordingDraft(...)`. Catch failures, set non-blocking warning, and keep recording.
- In `recorder.ondataavailable`, push chunk to `chunksRef.current`; if a draft exists, call `saveRecordingDraftChunk` with current index and increment after successful scheduling. Catch/recover by setting warning.
- Change `recorder.start();` to `recorder.start(RECORDING_CHUNK_MS);`.
- In the timer effect, update draft metadata periodically with elapsed seconds and current form values; catch failures and keep recording.
- Show recording reassurance text: `Recording is being saved locally as you go. Keep this page open for best results.` Include warning text if present.

Important: because `ondataavailable` cannot be `async` safely for browser flow, call `void saveRecordingDraftChunk(...).catch(...)` and increment `nextChunkIndexRef.current` synchronously after capturing the index.

- [ ] **Step 3: Verify task tests pass**

Run:
```bash
cd frontend && npm test -- src/components/scribe-mobile/record-view.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/scribe-mobile/record-view.tsx frontend/src/components/scribe-mobile/record-view.test.tsx
git commit -m "Persist mobile recording chunks locally"
```

## Task 3: Recover Interrupted Drafts

**Files:**
- Modify: `frontend/src/components/scribe-mobile/record-view.tsx`
- Modify: `frontend/src/components/scribe-mobile/record-view.test.tsx`

- [ ] **Step 1: Add failing recovery tests**

Extend `record-view.test.tsx` with tests that:
1. When `getActiveRecordingDraft` resolves metadata, idle view shows `Interrupted recording found`, recovery copy, `Recover recording`, and `Discard`.
2. Clicking `Recover recording` calls `buildRecordingDraftBlob`, creates a `File`, restores patient/department/autoTranscribe/elapsed seconds, creates object URL, and renders review UI with `Recovered from local device storage. Please review before saving.`
3. Clicking recovery `Discard` calls `deleteActiveRecordingDraft` and returns to normal idle controls.
4. If `buildRecordingDraftBlob` rejects, show error text and keep discard available.

Run:
```bash
cd frontend && npm test -- src/components/scribe-mobile/record-view.test.tsx
```
Expected: FAIL until recovery UI is implemented.

- [ ] **Step 2: Implement recovery flow**

Modify `record-view.tsx`:
- Extend `Phase` to include `"recovering"` only if useful; otherwise use `idle` plus `activeDraft` state.
- Add `activeDraft: RecordingDraftMetadata | null`, `isCheckingDraft`, and `isRecoveredDraft` state.
- On mount, call `getActiveRecordingDraft()`. If metadata exists, show a recovery panel instead of `IdlePhase` controls.
- Add `RecoveryDraftPhase` component with exact copy from spec:
  - Heading: `Interrupted recording found`
  - Body: `We saved audio from a previous recording on this device. Review and save it, or discard it.`
  - Buttons: `Recover recording`, `Discard`
- `handleRecoverDraft` builds blob from chunks, creates a `File` named with the stored extension, restores state, sets phase `review`, and sets `isRecoveredDraft=true`.
- `handleDiscardRecoveredDraft` calls `deleteActiveRecordingDraft`, clears `activeDraft`, resets state, and remains idle.
- Pass `isRecoveredDraft` into `ReviewPhase` and render note: `Recovered from local device storage. Please review before saving.`

- [ ] **Step 3: Verify recovery tests pass**

Run:
```bash
cd frontend && npm test -- src/components/scribe-mobile/record-view.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/scribe-mobile/record-view.tsx frontend/src/components/scribe-mobile/record-view.test.tsx
git commit -m "Recover interrupted mobile recordings"
```

## Task 4: Delete Drafts Only on Successful Save or Explicit Discard

**Files:**
- Modify: `frontend/src/components/scribe-mobile/record-view.tsx`
- Modify: `frontend/src/components/scribe-mobile/record-view.test.tsx`

- [ ] **Step 1: Add failing deletion tests**

Extend `record-view.test.tsx`:
1. Successful save calls `deleteActiveRecordingDraft` after `uploadAudio.mutateAsync` resolves and before/around `onSaved`.
2. Upload failure does **not** delete the draft and leaves review UI visible.
3. Review discard calls `deleteActiveRecordingDraft` and navigates back.
4. Back while recording stops tracks, suppresses review transition, calls `deleteActiveRecordingDraft`, and navigates back.
5. Re-record from review deletes the previous draft before starting a new recording.

Run:
```bash
cd frontend && npm test -- src/components/scribe-mobile/record-view.test.tsx
```
Expected: FAIL until deletion paths are complete.

- [ ] **Step 2: Implement deletion semantics**

Modify `record-view.tsx`:
- In `handleSave`, call `await deleteActiveRecordingDraft()` only after both create-session and upload succeed. Catch delete errors only for logging/warning; do not block `onSaved`.
- Do not delete draft in `catch` when upload fails.
- In `handleDiscard`, `handleBack`, and `onReRecord`, delete active draft because these are explicit discard/replacement actions.
- Ensure `reset()` clears `isRecoveredDraft`, `storageWarning`, `activeDraft`, `draftIdRef`, and `nextChunkIndexRef` as appropriate.

- [ ] **Step 3: Verify tests pass**

Run:
```bash
cd frontend && npm test -- src/components/scribe-mobile/record-view.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/scribe-mobile/record-view.tsx frontend/src/components/scribe-mobile/record-view.test.tsx
git commit -m "Clean up recording drafts after save or discard"
```

## Task 5: Full Verification and Polish

**Files:**
- Modify only if needed: `frontend/src/styles/janus-scribe-mobile.css`

- [ ] **Step 1: Run targeted tests**

```bash
cd frontend && npm test -- src/lib/recording-drafts.test.ts src/components/scribe-mobile/record-view.test.tsx
```
Expected: PASS.

- [ ] **Step 2: Run all frontend tests**

```bash
cd frontend && npm test
```
Expected: PASS.

- [ ] **Step 3: Run production frontend build**

```bash
cd frontend && npm run build
```
Expected: PASS; `tsc -b` and `vite build` complete without TypeScript errors.

- [ ] **Step 4: Manual browser test**

With dev servers running (`make dev-servers` or project standard):
1. Open mobile record view.
2. Enter patient id `manual-mobile-recovery`, choose `Department 1`, leave auto-transcribe checked.
3. Start recording and wait at least 12 seconds.
4. Refresh the page.
5. Confirm recovery card appears.
6. Click `Recover recording`.
7. Confirm review page shows playback and recovered note.
8. Save and confirm navigation to saved session.
9. Return to record view and confirm recovery card no longer appears.
10. Repeat with discard and confirm recovery card no longer appears.

- [ ] **Step 5: Commit any polish**

```bash
git status --short
git add frontend/src/styles/janus-scribe-mobile.css frontend/src/components/scribe-mobile/record-view.tsx frontend/src/components/scribe-mobile/record-view.test.tsx frontend/src/lib/recording-drafts.ts frontend/src/lib/recording-drafts.test.ts
git commit -m "Verify mobile recording resilience" || true
```
Only create this commit if files changed after Task 4.

## Acceptance Criteria

- `MediaRecorder.start` is called with `10000` milliseconds.
- Audio chunks emitted during recording are persisted in IndexedDB with stable ordering.
- Recording continues if IndexedDB is unavailable or a write fails; user sees a non-blocking warning.
- On mobile record view load, an existing active draft shows recovery/discard UI before idle controls.
- Recover reconstructs the Blob/File from ordered chunks and restores patient, department, auto-transcribe, elapsed seconds, and review flow.
- Draft is deleted after successful upload/save.
- Draft is not deleted after upload/save failure.
- Draft is deleted after explicit discard, back discard, or re-record replacement.
- No wake lock code is added.
- No auth refresh behavior is changed.
- `cd frontend && npm test` passes.
- `cd frontend && npm run build` passes.

## Risks and Rollback

Risks:
- Browser IndexedDB quota/private mode can reject writes; mitigation is warning plus in-memory recording fallback.
- Mobile browsers may still suspend recording before a 10-second chunk is emitted; maximum unrecovered tail is approximately the timeslice.
- IndexedDB Blob support varies in very old browsers; target modern mobile browsers should support it.
- Storing PHI-bearing audio locally increases privacy responsibility; UI copy must clearly tell users to save or discard recovered recordings.

Rollback:
1. Revert commits from Tasks 1-4.
2. Confirm `record-view.tsx` again uses in-memory chunks only and `recorder.start()` without timeslice.
3. Run:
   ```bash
   cd frontend && npm test && npm run build
   ```
4. If users have drafts from the rolled-back version, they remain in browser IndexedDB but the app will not surface them. Prefer a forward hotfix that restores recovery/discard UI if this occurs in production.
