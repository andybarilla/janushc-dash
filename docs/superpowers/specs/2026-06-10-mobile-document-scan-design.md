# Mobile camera document scanning

## Goal

Add a "Scan document" path to the `mobile-recorder` Expo app. A clinician captures
document pages with the device camera, the app assembles them into one PDF, and
submits it to the existing OCR flow at `POST /api/scribe/sessions/{id}/upload-document`.

No backend changes. The endpoint already accepts a multipart `document` field
(pdf/png/jpg/jpeg/tif/tiff, ≤50 MB) and runs Textract `StartTextDetection` →
4-section note. Textract handles multi-page PDFs.

## Flow

```
Sign in → Label / appointment → mode chooser
                                   ├─ Record audio  (existing RecordScreen)
                                   └─ Scan document (new ScanScreen)
                                        → native scanner (edge-detect, crop, multi-page)
                                        → assemble pages → single PDF (local file URI)
                                        → create session (label) → upload-document
```

The label step is unchanged. After a label is set, `App.tsx` shows a mode-chooser
step (two buttons) instead of going straight to `RecordScreen`. `ScanScreen` is a
peer of `RecordScreen`; both consume the same label and the same session-create +
pending/hold logic.

## Components

### Native scanner — `react-native-document-scanner-plugin@^2.0.4`

- Version 2.0.4 (published 2026-01-02) supports the React Native New Architecture
  (issue #151 closed 2025-09-28). The app runs Expo SDK 54 / RN 0.81 with New Arch
  on by default (`newArchEnabled` is unset in `app.json`), so this version is required;
  do not pin below 2.0.0.
- Not compatible with Expo Go — already true for this app (it uses `expo-dev-client`).
- API: `scanDocument({ croppedImageQuality: 60, responseType: 'imageFilePath' })`
  → `{ scannedImages: string[], status: 'success' | 'cancel' }`.
- `croppedImageQuality: 60` keeps multi-page PDFs well under the 50 MB cap and
  reduces memory pressure on lower-end Android.

`app.json` changes:
- Add to `plugins`: `["react-native-document-scanner-plugin", { "cameraPermission": "JanusHC uses the camera to scan documents for transcription and clinician review." }]`.
- Add `android.permission.CAMERA` to `android.permissions`.
- Add `NSCameraUsageDescription` to `ios.infoPlist` (config plugin sets it from
  `cameraPermission`, but keep the existing infoPlist conventions consistent).

### PDF assembly — `pdf-lib` (pure JS, no native)

`src/scan.ts` exports `scanToPdf(): Promise<string | null>`:
1. `scanDocument(...)`; if `status !== 'success'` or no images, return `null` (cancel).
2. For each image URI, read bytes with `expo-file-system` (base64 → `Uint8Array`).
3. `PDFDocument.create()`; per image: `embedJpg(bytes)`, add a page sized to the
   image dimensions, `drawImage` full-bleed.
4. `doc.save()` → bytes → base64 → write to a temp `.pdf` URI under the app cache
   dir via `expo-file-system`. Return that URI.

Pure-JS; relies on `Uint8Array`/`atob`/`btoa` which Expo provides. No new native dep
beyond the scanner.

### API client — `src/api.ts`

Add `uploadDocument(opts, sessionId, fileUri)` mirroring `uploadAudio`:
- multipart field `document`, name `janushc-<sessionId>.pdf`, type `application/pdf`.
- `POST /api/scribe/sessions/{sessionId}/upload-document`.
- Same 401 → `onUnauthorized()` and non-OK → throw handling as `uploadAudio`.

### Screens / navigation

- **Mode chooser** (`src/screens/choose-mode.tsx` or inline in `App.tsx`): two
  buttons, "Record audio" and "Scan document", plus a back action to the label.
- **`src/screens/scan.tsx`** (`ScanScreen`): kicks off `scanToPdf()`, shows progress
  while assembling + uploading, surfaces errors, and calls `onSettle`/`onDone` the
  same way `RecordScreen` does. Holds patient-consent affordance consistent with the
  record flow if applicable (documents are pre-existing records, so a consent toggle
  is not required — confirm during implementation, default to no toggle).
- `App.tsx` `Root`: after `label` is set, render the chooser; selecting a mode renders
  `RecordScreen` or `ScanScreen`. `onDone` returns to label entry as today.

## Reusing the upload / pending machinery

Generalize the existing queue rather than duplicate it.

- `upload-queue.ts`:
  - `PendingItem` gains `kind: 'audio' | 'document'`.
  - `ProcessDeps.uploadAudio` becomes `upload: (sessionId, item) => Promise<void>`.
    `processItem` is otherwise unchanged (create-session then upload, returning the
    furthest-reached status).
- `upload.ts` `runUpload`: dispatch the `upload` dep by `item.kind` to `uploadAudio`
  or `uploadDocument`.
- `pending.ts` `pendingFor(label, fileUri, kind, held?)`: set `kind`; resume logic
  unchanged. (For documents `fileUri` is the assembled PDF URI.)

This gives scans the same in-memory hold/resume protection against orphaning that
recordings have: a failed create-session stays `needs-session`, a failed upload stays
`needs-upload` with its session id, and "Later" does not orphan the work while the app
runs.

## Error handling

- Scanner cancel (`status !== 'success'`) → return to chooser, no session created.
- PDF assembly failure → alert, no session created, return to chooser.
- Create-session failure → item held `needs-session`, retryable.
- Upload failure → item held `needs-upload` with session id, retryable.
- 401 anywhere → existing sign-out path (`onUnauthorized`).

## Testing & verification

- Verification commands (this app, not the frontend build): `cd mobile-recorder &&
  npm run typecheck && npm test`.
- Update existing Jest suites for the generalized queue: `upload-queue.test.ts`,
  `pending.test.ts`, `upload.test.ts`. Add document-`kind` cases: create-session +
  upload dispatch to `uploadDocument`, failure-hold at each step, resume reuses the
  session id.
- `scanToPdf` PDF-assembly logic is unit-testable by mocking the scanner result and
  file-system reads; add `scan.test.ts` if the assembly logic is non-trivial.
- **Native rebuild required.** The scanner is a native module added via config plugin,
  so a new dev-client / EAS build is needed (`expo prebuild` + `expo run:android` or
  EAS). The feature will not appear in an already-installed dev client until rebuilt.

## Out of scope (v1)

- iOS-specific scanner tuning (the request targets Android; iOS works via the same
  plugin but is not the verification target).
- Persisting pending scans across app restarts (matches the recorder's deliberate v1
  limitation).
- In-app review/retake of individual pages beyond what the native scanner UI provides.
