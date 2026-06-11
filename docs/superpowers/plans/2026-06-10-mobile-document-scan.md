# Mobile Camera Document Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clinician scan a paper document with the camera in the `mobile-recorder` Expo app and submit it to the existing OCR upload-document flow.

**Architecture:** A new `ScanScreen` sits as a peer of `RecordScreen` behind a mode-chooser shown after the label step. A native document scanner captures pages; `pdf-lib` assembles them into one PDF; the existing session-create + pending/hold upload pipeline (generalized with a `kind` field) submits it to `POST /api/scribe/sessions/{id}/upload-document`. No backend changes.

**Tech Stack:** Expo SDK 54 / RN 0.81 (New Architecture on), TypeScript, Jest, `react-native-document-scanner-plugin@^2.0.4`, `pdf-lib`, `expo-file-system` (legacy API).

---

## Working directory

All commands run from `mobile-recorder/` unless an absolute path is shown. Verification for this app is `npm run typecheck` and `npm test` — NOT the frontend `vite build` in the repo CLAUDE.md.

## File structure

- `mobile-recorder/app.json` — add scanner config plugin + camera permission (modify)
- `mobile-recorder/package.json` / `package-lock.json` — new deps (modify)
- `mobile-recorder/src/upload-queue.ts` — add `kind` to `PendingItem`, rename `uploadAudio` dep to `upload` (modify)
- `mobile-recorder/src/pending.ts` — `pendingFor` takes a `kind` (modify)
- `mobile-recorder/src/api.ts` — add `uploadDocument` (modify)
- `mobile-recorder/src/upload.ts` — dispatch `upload` by `kind` (modify)
- `mobile-recorder/src/screens/record.tsx` — pass `'audio'` to `pendingFor` (modify)
- `mobile-recorder/src/scan.ts` — `scanToPdf()` orchestration (create)
- `mobile-recorder/src/scan.test.ts` — unit tests for `scanToPdf` (create)
- `mobile-recorder/src/screens/choose-mode.tsx` — record-vs-scan chooser (create)
- `mobile-recorder/src/screens/scan.tsx` — `ScanScreen` (create)
- `mobile-recorder/App.tsx` — insert chooser + scan into navigation (modify)
- `mobile-recorder/src/upload-queue.test.ts`, `pending.test.ts`, `upload.test.ts` — update for new shape (modify)

---

## Task 1: Add dependencies and Expo config

**Files:**
- Modify: `mobile-recorder/package.json`, `mobile-recorder/package-lock.json`
- Modify: `mobile-recorder/app.json`

- [ ] **Step 1: Install the scanner and pdf-lib**

Run (from `mobile-recorder/`):

```bash
npx expo install react-native-document-scanner-plugin
npm install pdf-lib
```

Expect `react-native-document-scanner-plugin` at `^2.0.4` or higher in `package.json` (2.0.x is the version that supports the New Architecture this app runs). `pdf-lib` is pure JS.

- [ ] **Step 2: Register the config plugin and camera permission in `app.json`**

In `mobile-recorder/app.json`, add `"android.permission.CAMERA"` to `expo.android.permissions` (append to the existing array), and add the scanner plugin entry to `expo.plugins` (append after the google-signin entry):

```json
      [
        "react-native-document-scanner-plugin",
        {
          "cameraPermission": "JanusHC uses the camera to scan documents for transcription and clinician review."
        }
      ]
```

The resulting `expo.android.permissions` array:

```json
      "permissions": [
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_MICROPHONE",
        "POST_NOTIFICATIONS",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.CAMERA"
      ]
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: PASS (no source uses the new modules yet).

- [ ] **Step 4: Commit**

```bash
git add mobile-recorder/package.json mobile-recorder/package-lock.json mobile-recorder/app.json
git commit -m "feat(mobile): add document-scanner and pdf-lib deps + camera config"
```

---

## Task 2: Generalize the upload pipeline for documents

This is one atomic refactor: `PendingItem` gains `kind`, the queue dep is renamed `uploadAudio` → `upload`, `api.ts` gains `uploadDocument`, and `runUpload` dispatches by `kind`. All call sites and tests update together so the suite is green at the end.

**Files:**
- Modify: `mobile-recorder/src/upload-queue.ts`
- Modify: `mobile-recorder/src/pending.ts`
- Modify: `mobile-recorder/src/api.ts`
- Modify: `mobile-recorder/src/upload.ts`
- Modify: `mobile-recorder/src/screens/record.tsx`
- Test: `mobile-recorder/src/upload-queue.test.ts`, `pending.test.ts`, `upload.test.ts`

- [ ] **Step 1: Update the tests to the new shape (write the failing tests first)**

Replace `mobile-recorder/src/upload-queue.test.ts` with:

```typescript
import { processItem, PendingItem } from './upload-queue';

function baseItem(): PendingItem {
  return {
    id: 'r1',
    fileUri: 'file:///tmp/r1.m4a',
    label: 'Jane D.',
    kind: 'audio',
    sessionId: null,
    status: 'needs-session',
  };
}

test('creates a session then uploads, reaching done', async () => {
  const calls: string[] = [];
  const result = await processItem(baseItem(), {
    createSession: async () => {
      calls.push('create');
      return 'sess-1';
    },
    upload: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });

  expect(calls).toEqual(['create', 'upload:sess-1']);
  expect(result.status).toBe('done');
  expect(result.sessionId).toBe('sess-1');
});

test('skips session creation when sessionId already exists', async () => {
  const calls: string[] = [];
  const item: PendingItem = { ...baseItem(), sessionId: 'sess-1', status: 'needs-upload' };

  const result = await processItem(item, {
    createSession: async () => {
      calls.push('create');
      return 'should-not-happen';
    },
    upload: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });

  expect(calls).toEqual(['upload:sess-1']);
  expect(result.status).toBe('done');
});

test('upload failure keeps the session id for a later resume', async () => {
  const result = await processItem(baseItem(), {
    createSession: async () => 'sess-1',
    upload: async () => {
      throw new Error('network down');
    },
  });

  expect(result.status).toBe('needs-upload');
  expect(result.sessionId).toBe('sess-1');
});

test('session creation failure stays at needs-session and skips upload', async () => {
  const calls: string[] = [];
  const result = await processItem(baseItem(), {
    createSession: async () => {
      calls.push('create');
      throw new Error('network down');
    },
    upload: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });
  expect(calls).toEqual(['create']);
  expect(result.status).toBe('needs-session');
  expect(result.sessionId).toBeNull();
});

test('a document item carries kind through to done', async () => {
  const item: PendingItem = { ...baseItem(), kind: 'document', fileUri: 'file:///tmp/scan.pdf' };
  const result = await processItem(item, {
    createSession: async () => 'sess-2',
    upload: async () => undefined,
  });
  expect(result.kind).toBe('document');
  expect(result.status).toBe('done');
});
```

In `mobile-recorder/src/pending.test.ts`, update the `item()` factory to include `kind: 'audio'` and update the two `pendingFor` call sites to pass a kind. Replace the factory and the `pendingFor` tests:

```typescript
function item(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    id: 'rec-1',
    fileUri: 'file:///tmp/rec-1.m4a',
    label: 'Jane D.',
    kind: 'audio',
    sessionId: null,
    status: 'needs-session',
    ...overrides,
  };
}
```

```typescript
test('pendingFor builds a fresh needs-session item with no held attempt', () => {
  const result = pendingFor('Jane D.', 'file:///new.m4a', 'audio');
  expect(result).toMatchObject({
    label: 'Jane D.',
    fileUri: 'file:///new.m4a',
    kind: 'audio',
    sessionId: null,
    status: 'needs-session',
  });
  expect(typeof result.id).toBe('string');
  expect(result.id.length).toBeGreaterThan(0);
});

test('pendingFor reuses a held session so a re-record does not duplicate it', () => {
  const held = item({ status: 'needs-upload', sessionId: 'sess-1' });
  const result = pendingFor('Jane D.', 'file:///rerecord.m4a', 'audio', held);
  expect(result.sessionId).toBe('sess-1');
  expect(result.status).toBe('needs-upload');
  expect(result.fileUri).toBe('file:///rerecord.m4a');
  expect(result.id).toBe('rec-1');
});

test('pendingFor ignores a held attempt that never created a session', () => {
  const held = item({ status: 'needs-session', sessionId: null });
  const result = pendingFor('Jane D.', 'file:///rerecord.m4a', 'audio', held);
  expect(result.sessionId).toBeNull();
  expect(result.status).toBe('needs-session');
});

test('pendingFor records the document kind', () => {
  const result = pendingFor('Jane D.', 'file:///scan.pdf', 'document');
  expect(result.kind).toBe('document');
});
```

In `mobile-recorder/src/upload.test.ts`, add `uploadDocument` to the mock, the `item()` factory `kind`, and a dispatch test. Replace the mock line, factory, and add the new test:

```typescript
import { createSession, uploadAudio, uploadDocument } from './api';
import { runUpload } from './upload';
import { PendingItem } from './upload-queue';

jest.mock('./api', () => ({
  createSession: jest.fn(),
  uploadAudio: jest.fn(),
  uploadDocument: jest.fn(),
}));

const createSessionMock = createSession as jest.MockedFunction<typeof createSession>;
const uploadAudioMock = uploadAudio as jest.MockedFunction<typeof uploadAudio>;
const uploadDocumentMock = uploadDocument as jest.MockedFunction<typeof uploadDocument>;

const opts = { baseUrl: 'http://x', token: 't', onUnauthorized: () => undefined };

function item(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    id: 'rec-1',
    fileUri: 'file:///rec-1.m4a',
    label: 'Jane D.',
    kind: 'audio',
    sessionId: null,
    status: 'needs-session',
    ...overrides,
  };
}

beforeEach(() => {
  createSessionMock.mockReset();
  uploadAudioMock.mockReset();
  uploadDocumentMock.mockReset();
});
```

Add this test at the end of `upload.test.ts`:

```typescript
test('uploads via uploadDocument for a document item', async () => {
  createSessionMock.mockResolvedValue({
    id: 'sess-9',
    patient_id: '',
    appointment_id: '',
    encounter_id: '',
    department_id: '',
    status: 'created',
  });
  uploadDocumentMock.mockResolvedValue();

  const result = await runUpload(opts, item({ kind: 'document', fileUri: 'file:///scan.pdf' }));

  expect(uploadDocumentMock).toHaveBeenCalledWith(opts, 'sess-9', 'file:///scan.pdf');
  expect(uploadAudioMock).not.toHaveBeenCalled();
  expect(result.status).toBe('done');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `upload-queue.test.ts` fails to typecheck/run on `upload`/`kind`, `upload.test.ts` fails on `uploadDocument` import.

- [ ] **Step 3: Generalize `upload-queue.ts`**

Replace `mobile-recorder/src/upload-queue.ts` with:

```typescript
export type PendingStatus = 'needs-session' | 'needs-upload' | 'done';

export type PendingKind = 'audio' | 'document';

export type PendingItem = {
  id: string;
  fileUri: string;
  label: string;
  kind: PendingKind;
  sessionId: string | null;
  status: PendingStatus;
};

export type ProcessDeps = {
  createSession: (item: PendingItem) => Promise<string>;
  upload: (sessionId: string, item: PendingItem) => Promise<void>;
};

// Advances one pending item as far as it can. On failure it returns the item
// with the furthest-reached status (and any session id) so a later retry resumes
// at the right step instead of creating a duplicate session.
export async function processItem(item: PendingItem, deps: ProcessDeps): Promise<PendingItem> {
  let sessionId = item.sessionId;

  if (!sessionId) {
    try {
      sessionId = await deps.createSession(item);
    } catch {
      return { ...item, status: 'needs-session' };
    }
  }

  try {
    await deps.upload(sessionId, item);
  } catch {
    return { ...item, sessionId, status: 'needs-upload' };
  }

  return { ...item, sessionId, status: 'done' };
}
```

- [ ] **Step 4: Update `pending.ts` to take a kind**

Replace `pendingFor` in `mobile-recorder/src/pending.ts` (leave `upsertPending` unchanged):

```typescript
import { PendingItem, PendingKind } from './upload-queue';

// Builds the pending item for a freshly captured file. When an earlier attempt
// is still held with a session, the new capture reuses that session instead of
// creating a duplicate (and orphaning the first).
export function pendingFor(
  label: string,
  fileUri: string,
  kind: PendingKind,
  held?: PendingItem | null,
): PendingItem {
  return {
    id: held?.id ?? String(Date.now()),
    fileUri,
    label,
    kind,
    sessionId: held?.sessionId ?? null,
    status: held?.sessionId ? 'needs-upload' : 'needs-session',
  };
}
```

- [ ] **Step 5: Add `uploadDocument` to `api.ts`**

In `mobile-recorder/src/api.ts`, add after `uploadAudio`:

```typescript
// Uploads an assembled document PDF to an existing session, kicking off the
// backend OCR flow. Mirrors uploadAudio's multipart + 401 handling.
export async function uploadDocument(opts: ApiOptions, sessionId: string, fileUri: string): Promise<void> {
  const form = new FormData();
  form.append('document', {
    uri: fileUri,
    name: `janushc-${sessionId}.pdf`,
    type: 'application/pdf',
  } as unknown as Blob);

  const res = await fetch(
    `${normalizeBaseUrl(opts.baseUrl)}/api/scribe/sessions/${sessionId}/upload-document`,
    { method: 'POST', headers: authHeaders(opts.token), body: form },
  );
  if (res.status === 401) {
    opts.onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`document upload failed: HTTP ${res.status} ${text}`);
  }
}
```

- [ ] **Step 6: Dispatch by kind in `upload.ts`**

Replace `mobile-recorder/src/upload.ts` with:

```typescript
import { ApiOptions, createSession, uploadAudio, uploadDocument } from './api';
import { PendingItem, processItem } from './upload-queue';

// Drives one pending item through session-create + upload against the live API,
// resuming at whatever step it last failed on. The upload step dispatches by the
// item's kind. Never throws: processItem catches API errors and returns the item
// at its furthest-reached status.
export function runUpload(opts: ApiOptions, item: PendingItem): Promise<PendingItem> {
  return processItem(item, {
    createSession: async (it) => (await createSession(opts, { label: it.label })).id,
    upload: (sessionId, it) =>
      it.kind === 'document'
        ? uploadDocument(opts, sessionId, it.fileUri)
        : uploadAudio(opts, sessionId, it.fileUri),
  });
}
```

- [ ] **Step 7: Update the `pendingFor` call in `record.tsx`**

In `mobile-recorder/src/screens/record.tsx`, change the `upload` helper's `pendingFor` call to pass `'audio'`:

```typescript
  async function upload(fileUri: string) {
    await attempt(pendingFor(label, fileUri, 'audio', resume), 'Upload incomplete');
  }
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — all queue/pending/upload tests green, no type errors.

- [ ] **Step 9: Commit**

```bash
git add mobile-recorder/src/upload-queue.ts mobile-recorder/src/pending.ts mobile-recorder/src/api.ts mobile-recorder/src/upload.ts mobile-recorder/src/screens/record.tsx mobile-recorder/src/upload-queue.test.ts mobile-recorder/src/pending.test.ts mobile-recorder/src/upload.test.ts
git commit -m "feat(mobile): generalize upload pipeline for documents"
```

---

## Task 3: Scan-to-PDF orchestration

**Files:**
- Create: `mobile-recorder/src/scan.ts`
- Test: `mobile-recorder/src/scan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile-recorder/src/scan.test.ts`:

```typescript
import { scanToPdf } from './scan';

const scanDocumentMock = jest.fn();
const embedJpgMock = jest.fn();
const addPageMock = jest.fn();
const drawImageMock = jest.fn();
const saveAsBase64Mock = jest.fn();
const readMock = jest.fn();
const writeMock = jest.fn();

jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: (...args: unknown[]) => scanDocumentMock(...args) },
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: (...args: unknown[]) => readMock(...args),
  writeAsStringAsync: (...args: unknown[]) => writeMock(...args),
}));

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: async () => ({
      embedJpg: (...args: unknown[]) => embedJpgMock(...args),
      addPage: (...args: unknown[]) => addPageMock(...args),
      saveAsBase64: (...args: unknown[]) => saveAsBase64Mock(...args),
    }),
  },
}));

beforeEach(() => {
  scanDocumentMock.mockReset();
  embedJpgMock.mockReset();
  addPageMock.mockReset();
  drawImageMock.mockReset();
  saveAsBase64Mock.mockReset();
  readMock.mockReset();
  writeMock.mockReset();

  embedJpgMock.mockResolvedValue({ width: 100, height: 200 });
  addPageMock.mockReturnValue({ drawImage: (...args: unknown[]) => drawImageMock(...args) });
  saveAsBase64Mock.mockResolvedValue('PDF_BASE64');
  readMock.mockResolvedValue('IMG_BASE64');
  writeMock.mockResolvedValue(undefined);
});

test('returns null when the user cancels', async () => {
  scanDocumentMock.mockResolvedValue({ status: 'cancel', scannedImages: [] });
  expect(await scanToPdf()).toBeNull();
  expect(writeMock).not.toHaveBeenCalled();
});

test('returns null when no images come back', async () => {
  scanDocumentMock.mockResolvedValue({ status: 'success', scannedImages: [] });
  expect(await scanToPdf()).toBeNull();
});

test('assembles all pages into one PDF and writes it to cache', async () => {
  scanDocumentMock.mockResolvedValue({
    status: 'success',
    scannedImages: ['file:///a.jpg', 'file:///b.jpg'],
  });

  const uri = await scanToPdf();

  expect(readMock).toHaveBeenCalledTimes(2);
  expect(embedJpgMock).toHaveBeenCalledTimes(2);
  expect(embedJpgMock).toHaveBeenCalledWith('IMG_BASE64');
  expect(drawImageMock).toHaveBeenCalledTimes(2);
  expect(writeMock).toHaveBeenCalledWith(
    expect.stringContaining('file:///cache/'),
    'PDF_BASE64',
    { encoding: 'base64' },
  );
  expect(uri).toEqual(expect.stringContaining('file:///cache/'));
  expect(uri).toEqual(expect.stringContaining('.pdf'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- scan.test.ts`
Expected: FAIL with "Cannot find module './scan'".

- [ ] **Step 3: Write `scan.ts`**

Create `mobile-recorder/src/scan.ts`:

```typescript
import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument } from 'pdf-lib';
import DocumentScanner from 'react-native-document-scanner-plugin';

// Launches the native document scanner, then assembles the returned JPEG pages
// into a single PDF written to the app cache. Returns the PDF's file URI, or null
// when the user cancels or no pages are captured. croppedImageQuality keeps a
// multi-page PDF well under the backend's 50 MB cap.
export async function scanToPdf(): Promise<string | null> {
  const { scannedImages, status } = await DocumentScanner.scanDocument({
    croppedImageQuality: 60,
    responseType: 'imageFilePath',
  });
  if (status !== 'success' || !scannedImages || scannedImages.length === 0) {
    return null;
  }

  const doc = await PDFDocument.create();
  for (const uri of scannedImages) {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const img = await doc.embedJpg(base64);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  const pdfBase64 = await doc.saveAsBase64();
  const path = `${FileSystem.cacheDirectory}janushc-scan-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(path, pdfBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- scan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile-recorder/src/scan.ts mobile-recorder/src/scan.test.ts
git commit -m "feat(mobile): scan documents and assemble a PDF"
```

---

## Task 4: Mode chooser, scan screen, and navigation

No unit tests — these are UI screens verified by typecheck and a manual native build. Keep styles consistent with `record.tsx` / `label-entry.tsx`.

**Files:**
- Create: `mobile-recorder/src/screens/choose-mode.tsx`
- Create: `mobile-recorder/src/screens/scan.tsx`
- Modify: `mobile-recorder/App.tsx`

- [ ] **Step 1: Create the mode chooser**

Create `mobile-recorder/src/screens/choose-mode.tsx`:

```tsx
import { Button, StyleSheet, Text, View } from 'react-native';

export type CaptureMode = 'record' | 'scan';

export function ChooseModeScreen({
  label,
  onChoose,
  onBack,
}: {
  label: string;
  onChoose: (mode: CaptureMode) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.patient}>{label}</Text>
      <Text style={styles.help}>What do you want to capture?</Text>
      <Button title="Record audio" color="#166534" onPress={() => onChoose('record')} />
      <Button title="Scan document" color="#166534" onPress={() => onChoose('scan')} />
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  patient: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  help: { color: '#64748b' },
});
```

- [ ] **Step 2: Create the scan screen**

Create `mobile-recorder/src/screens/scan.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { pendingFor } from '../pending';
import { scanToPdf } from '../scan';
import { runUpload } from '../upload';
import { PendingItem } from '../upload-queue';

export function ScanScreen({
  label,
  onDone,
  onSettle,
}: {
  label: string;
  onDone: () => void;
  onSettle: (item: PendingItem) => void;
}) {
  const { token, baseUrl, signOut } = useAuth();
  const signedOut = useRef(false);
  const opts = useMemo(
    () => ({ baseUrl, token, onUnauthorized: () => { signedOut.current = true; signOut(); } }),
    [baseUrl, token, signOut],
  );
  const [busy, setBusy] = useState(false);

  async function startScan() {
    setBusy(true);
    let pdfUri: string | null;
    try {
      pdfUri = await scanToPdf();
    } catch (err) {
      setBusy(false);
      Alert.alert('Scan failed', String(err));
      return;
    }
    if (!pdfUri) {
      setBusy(false);
      return; // user cancelled the scanner
    }
    await attempt(pendingFor(label, pdfUri, 'document', null), 'Upload incomplete');
  }

  async function attempt(item: PendingItem, failureTitle: string) {
    const result = await runUpload(opts, item);
    setBusy(false);
    // Hold (or clear, when done) before prompting so dismissing the alert or
    // hitting Back cannot orphan the scan.
    onSettle(result);

    if (result.status === 'done') {
      Alert.alert('Uploaded', 'Document sent to the scribe inbox.');
      onDone();
    } else if (signedOut.current) {
      onDone();
    } else {
      Alert.alert(failureTitle, 'The scan is saved on this device. Retry?', [
        { text: 'Later', style: 'cancel', onPress: onDone },
        { text: 'Retry', onPress: () => { setBusy(true); attempt(result, 'Still failing'); } },
      ]);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.patient}>{label}</Text>
      {busy ? (
        <Text style={styles.body}>Working…</Text>
      ) : (
        <>
          <Button title="Scan document" color="#166534" onPress={startScan} />
          <Button title="Back" onPress={onDone} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  patient: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  body: { color: '#1e293b' },
});
```

- [ ] **Step 3: Wire the chooser and scan screen into `App.tsx`**

In `mobile-recorder/App.tsx`, add a `mode` state and route through the chooser. Replace the imports and `Root` function:

```tsx
import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { upsertPending } from './src/pending';
import { ChooseModeScreen, CaptureMode } from './src/screens/choose-mode';
import { LabelEntryScreen } from './src/screens/label-entry';
import { RecordScreen } from './src/screens/record';
import { ScanScreen } from './src/screens/scan';
import { SignInScreen } from './src/screens/sign-in';
import { PendingItem } from './src/upload-queue';

function Root() {
  const { ready, token } = useAuth();
  const [label, setLabel] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode | null>(null);
  // Captures whose upload has not yet succeeded, held in memory so "Later" does
  // not orphan them. Not persisted across an app restart (deliberate v1).
  const [pending, setPending] = useState<PendingItem[]>([]);

  function settle(item: PendingItem) {
    setPending((prev) => upsertPending(prev, item));
  }

  // Return to label entry after a capture settles or the user backs out.
  function reset() {
    setMode(null);
    setLabel(null);
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (!label) return <LabelEntryScreen onSelect={(l) => { setLabel(l); setMode(null); }} />;
  if (!mode) {
    return <ChooseModeScreen label={label} onChoose={setMode} onBack={reset} />;
  }
  if (mode === 'record') {
    // resume is null: a freeform label is not a stable, unique key (two patients
    // could share initials), so we never reuse a held session across captures.
    return <RecordScreen label={label} resume={null} onSettle={settle} onDone={reset} />;
  }
  return <ScanScreen label={label} onSettle={settle} onDone={reset} />;
}
```

Leave the `App` default export and `styles` unchanged. Note `pending` is held but not yet read here (same as before this change); the in-memory hold guards orphaning within a session via `settle`.

- [ ] **Step 4: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS — no type errors, all existing tests green.

- [ ] **Step 5: Commit**

```bash
git add mobile-recorder/App.tsx mobile-recorder/src/screens/choose-mode.tsx mobile-recorder/src/screens/scan.tsx
git commit -m "feat(mobile): add scan-document capture mode and chooser"
```

---

## Task 5: Native build verification

The scanner is a native module added via config plugin, so it only appears after a fresh native build. This task is manual and has no commit.

- [ ] **Step 1: Prebuild and run on Android**

Run (from `mobile-recorder/`):

```bash
npx expo prebuild --platform android --clean
npx expo run:android
```

(Or trigger an EAS build with the existing `eas.json` profile.)

- [ ] **Step 2: Manually verify the flow**

1. Sign in, enter a label, tap **Scan document**.
2. Tap **Scan document** again → the native scanner opens. Capture 2 pages.
3. Confirm the scanner returns; the screen shows **Working…**, then an **Uploaded** alert.
4. In the web app's scribe inbox, confirm a new session for that label appears with a document filename and that OCR produced a 4-section note.
5. Test cancel: open the scanner and cancel → returns to the scan screen, no session created.
6. Test failure: with the device offline, scan → confirm the "Upload incomplete / Retry" alert, then reconnect and **Retry** → uploads without creating a duplicate session.

---

## Notes for the implementer

- Run all commands from `mobile-recorder/`.
- This app's verification is `npm run typecheck` + `npm test`. Ignore the repo-root CLAUDE.md's `vite build` instruction; that is for the web `frontend/`.
- `react-native-document-scanner-plugin` must stay at `>=2.0.0` — earlier versions predate New Architecture support and will fail the native build (SDK 54 has New Arch on by default).
- The default export of the scanner is `DocumentScanner`; call `DocumentScanner.scanDocument(...)`.
- `expo-file-system/legacy` is the stable string/base64 file API in SDK 54; use it rather than the new `File`/`Paths` classes for the read/write here.
