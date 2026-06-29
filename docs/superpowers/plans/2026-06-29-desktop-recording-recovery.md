# Desktop Recording Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let desktop users recover an interrupted browser recording (buffered in IndexedDB) without forcing the mobile layout.

**Architecture:** A detection hook reads the active IndexedDB draft; a presentational banner on the desktop scribe page offers Recover/Discard; Recover rebuilds the audio blob and hands it to the existing `UploadModal`, which gains pre-fill props so the user reviews and saves through the unchanged `createSession` + `uploadAudio` path. Draft deletion on a successful save is wired in `DesktopScribe`'s existing `onCreated` callback, so the modal stays unaware of recovery.

**Tech Stack:** React 19 + TypeScript, Vitest + jsdom + @testing-library/react, existing TanStack Query hooks in `frontend/src/lib/scribe-queries.ts`, IndexedDB helpers in `frontend/src/lib/recording-drafts.ts`.

## Global Constraints

- All paths are under `frontend/`. Run all commands from `frontend/`.
- Test runner: `npm test` (`vitest run`). Single file: `npx vitest run <path>`.
- Build/typecheck gate (matches production Dockerfile): `npm run build` (`tsc -b && vite build`).
- Tests mock `@/lib/recording-drafts`, `@/lib/scribe-queries`, and `@/lib/auth` with `vi.hoisted` + `vi.mock`, following `src/components/scribe-mobile/record-view.test.tsx`.
- Draft store holds a single draft, id `ACTIVE_RECORDING_DRAFT_ID` (`"active-mobile-recording"`), exported from `@/lib/recording-drafts`.
- A draft is shown only when `draft.ownerUserId === currentUserId`.
- Use the project's existing `janus-*` CSS classes for desktop UI; do not introduce mobile `m-*` classes on desktop.

---

### Task 1: `useActiveRecordingDraft` detection hook

**Files:**
- Create: `frontend/src/lib/use-active-recording-draft.ts`
- Test: `frontend/src/lib/use-active-recording-draft.test.tsx`

**Interfaces:**
- Consumes: `getActiveRecordingDraft(): Promise<RecordingDraftMetadata | null>` and the `RecordingDraftMetadata` type from `@/lib/recording-drafts`.
- Produces:
  ```ts
  function useActiveRecordingDraft(currentUserId: string | null): {
    draft: RecordingDraftMetadata | null;
    loading: boolean;
    refresh: () => void;
  }
  ```
  `draft` is non-null only when a draft exists and `draft.ownerUserId === currentUserId`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/use-active-recording-draft.test.tsx`:

```tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveRecordingDraft } from "./use-active-recording-draft";

const mocks = vi.hoisted(() => ({
  getActiveRecordingDraft: vi.fn(),
}));

vi.mock("@/lib/recording-drafts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recording-drafts")>(
    "@/lib/recording-drafts",
  );
  return { ...actual, getActiveRecordingDraft: mocks.getActiveRecordingDraft };
});

const draft = {
  draftId: "active-mobile-recording",
  ownerUserId: "user-1",
  mimeType: "audio/webm",
  fileExtension: "webm",
  patientId: "patient-2",
  appointmentId: "appt-2",
  patientName: "John Roe",
  appointmentTime: "10:00",
  departmentId: "dept-2",
  autoTranscribe: true,
  startedAt: "2026-06-29T14:42:00.000Z",
  updatedAt: "2026-06-29T14:44:00.000Z",
  elapsedSeconds: 75,
  nextChunkIndex: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("useActiveRecordingDraft", () => {
  it("returns a draft owned by the current user", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValue(draft);
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).toEqual(draft);
  });

  it("hides a draft owned by another user", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValue({ ...draft, ownerUserId: "other" });
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).toBeNull();
  });

  it("returns null when there is no draft", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValue(null);
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).toBeNull();
  });

  it("re-reads the draft when refresh is called", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValueOnce(draft).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.draft).toEqual(draft));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.draft).toBeNull());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/use-active-recording-draft.test.tsx`
Expected: FAIL — cannot resolve `./use-active-recording-draft`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/lib/use-active-recording-draft.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import {
  getActiveRecordingDraft,
  type RecordingDraftMetadata,
} from "@/lib/recording-drafts";

export function useActiveRecordingDraft(currentUserId: string | null): {
  draft: RecordingDraftMetadata | null;
  loading: boolean;
  refresh: () => void;
} {
  const [draft, setDraft] = useState<RecordingDraftMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getActiveRecordingDraft()
      .then((result) => {
        if (!active) return;
        setDraft(result && result.ownerUserId === currentUserId ? result : null);
      })
      .catch(() => {
        if (active) setDraft(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUserId, tick]);

  return { draft, loading, refresh };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/use-active-recording-draft.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-active-recording-draft.ts src/lib/use-active-recording-draft.test.tsx
git commit -m "feat: add useActiveRecordingDraft hook"
```

---

### Task 2: Recovery banner component

**Files:**
- Create: `frontend/src/components/scribe/recovery-banner.tsx`
- Test: `frontend/src/components/scribe/recovery-banner.test.tsx`

**Interfaces:**
- Consumes: `RecordingDraftMetadata` from `@/lib/recording-drafts`.
- Produces:
  ```ts
  interface RecoveryBannerProps {
    draft: RecordingDraftMetadata;
    onRecover: () => void;
    onDiscard: () => void;
    error?: string | null;
  }
  function RecoveryBanner(props: RecoveryBannerProps): JSX.Element
  ```
  Renders elapsed time as `mm:ss` (from `draft.elapsedSeconds`) and the start time (from `draft.startedAt`, formatted as a local time string), plus **Recover recording** and **Discard** buttons and an optional error line.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/scribe/recovery-banner.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryBanner } from "./recovery-banner";

const draft = {
  draftId: "active-mobile-recording",
  ownerUserId: "user-1",
  mimeType: "audio/webm",
  fileExtension: "webm",
  patientId: "patient-2",
  appointmentId: "appt-2",
  departmentId: "dept-2",
  autoTranscribe: true,
  startedAt: "2026-06-29T14:42:00.000Z",
  updatedAt: "2026-06-29T14:44:00.000Z",
  elapsedSeconds: 75,
  nextChunkIndex: 8,
};

afterEach(cleanup);

describe("RecoveryBanner", () => {
  it("shows the elapsed duration", () => {
    render(<RecoveryBanner draft={draft} onRecover={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/01:15/)).toBeInTheDocument();
  });

  it("calls onRecover and onDiscard", () => {
    const onRecover = vi.fn();
    const onDiscard = vi.fn();
    render(<RecoveryBanner draft={draft} onRecover={onRecover} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole("button", { name: "Recover recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("renders an error message when provided", () => {
    render(
      <RecoveryBanner draft={draft} onRecover={vi.fn()} onDiscard={vi.fn()} error="No audio chunks found." />,
    );
    expect(screen.getByText("No audio chunks found.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/scribe/recovery-banner.test.tsx`
Expected: FAIL — cannot resolve `./recovery-banner`.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/scribe/recovery-banner.tsx`:

```tsx
import { AlertTriangle } from "lucide-react";
import type { RecordingDraftMetadata } from "@/lib/recording-drafts";

interface RecoveryBannerProps {
  draft: RecordingDraftMetadata;
  onRecover: () => void;
  onDiscard: () => void;
  error?: string | null;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatStart(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RecoveryBanner({ draft, onRecover, onDiscard, error }: RecoveryBannerProps) {
  const startedAt = formatStart(draft.startedAt);
  return (
    <div className="janus-card" role="status" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <AlertTriangle style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong>Unsaved recording</strong>
          <div className="janus-help-text">
            {formatDuration(draft.elapsedSeconds)}
            {startedAt ? ` · started ${startedAt}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="janus-btn janus-btn-primary janus-btn-sm" onClick={onRecover}>
            Recover recording
          </button>
          <button type="button" className="janus-btn janus-btn-ghost janus-btn-sm" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>
      {error ? <div className="janus-error-text">{error}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/scribe/recovery-banner.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/scribe/recovery-banner.tsx src/components/scribe/recovery-banner.test.tsx
git commit -m "feat: add desktop recovery banner component"
```

---

### Task 3: `UploadModal` pre-fill support

**Files:**
- Modify: `frontend/src/components/scribe/upload-modal.tsx`
- Test: `frontend/src/components/scribe/upload-modal.test.tsx` (create)

**Interfaces:**
- Consumes: `ScribeAppointment` from `@/lib/scribe-queries`; existing hooks `useCreateScribeSession`, `useUploadScribeAudio`, `useUploadScribeDocument`, `useScribeDepartments`, `useTodayAppointments`.
- Produces: `UploadModal` `Props` gains:
  ```ts
  initialAudioFile?: File | null;
  initialDepartmentId?: string;
  initialAppointmentId?: string;
  initialAutoTranscribe?: boolean;
  extraAppointment?: ScribeAppointment;
  ```
  When opened with a non-null `initialAudioFile`, the modal shows the audio in the "recorded" state with department/appointment/auto-transcribe pre-selected, and `extraAppointment` is selectable even if not in today's list.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/scribe/upload-modal.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadModal } from "./upload-modal";

const mocks = vi.hoisted(() => ({
  useCreateScribeSession: vi.fn(),
  useUploadScribeAudio: vi.fn(),
  useUploadScribeDocument: vi.fn(),
  useScribeDepartments: vi.fn(),
  useTodayAppointments: vi.fn(),
}));

vi.mock("@/lib/scribe-queries", () => ({
  useCreateScribeSession: mocks.useCreateScribeSession,
  useUploadScribeAudio: mocks.useUploadScribeAudio,
  useUploadScribeDocument: mocks.useUploadScribeDocument,
  useScribeDepartments: mocks.useScribeDepartments,
  useTodayAppointments: mocks.useTodayAppointments,
}));

const extraAppointment = {
  appointment_id: "appt-9",
  patient_id: "patient-9",
  patient_name: "Recovered Patient",
  time: "11:15",
  department_id: "dept-1",
  status: "",
};

let createSession: ReturnType<typeof vi.fn>;
let uploadAudio: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  createSession = vi.fn().mockResolvedValue({ id: "session-1" });
  uploadAudio = vi.fn().mockResolvedValue(undefined);
  mocks.useCreateScribeSession.mockReturnValue({ mutateAsync: createSession, isPending: false, error: null });
  mocks.useUploadScribeAudio.mockReturnValue({ mutateAsync: uploadAudio, isPending: false, error: null });
  mocks.useUploadScribeDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
  mocks.useScribeDepartments.mockReturnValue({
    data: [{ id: "dept-1", name: "Dept 1" }],
    isLoading: false,
    isError: false,
  });
  mocks.useTodayAppointments.mockReturnValue({ data: [], isLoading: false, isError: false });
  if (!("createObjectURL" in URL)) {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn() });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
  }
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovered");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(cleanup);

describe("UploadModal recovery pre-fill", () => {
  it("pre-fills recovered audio and saves through createSession + uploadAudio", async () => {
    const recoveredFile = new File([new Blob(["x"])], "recovered-recording.webm", { type: "audio/webm" });
    const onCreated = vi.fn();
    render(
      <UploadModal
        open
        onClose={vi.fn()}
        onCreated={onCreated}
        initialAudioFile={recoveredFile}
        initialDepartmentId="dept-1"
        initialAppointmentId="appt-9"
        initialAutoTranscribe
        extraAppointment={extraAppointment}
      />,
    );

    // Recovered audio is shown in the "recorded" state.
    expect(await screen.findByText("Recording ready to upload")).toBeInTheDocument();
    // The injected appointment is selected (its patient resolves) so Save is enabled.
    const saveButton = screen.getByRole("button", { name: /Save/ });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith({
        patient_id: "patient-9",
        appointment_id: "appt-9",
        department_id: "dept-1",
      }),
    );
    expect(uploadAudio).toHaveBeenCalledWith({ id: "session-1", file: recoveredFile, autoTranscribe: true });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("session-1"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/scribe/upload-modal.test.tsx`
Expected: FAIL — `initialAudioFile` is not honored, so the modal shows the idle "Ready to record" state and Save stays disabled.

- [ ] **Step 3: Add pre-fill props and behavior**

In `frontend/src/components/scribe/upload-modal.tsx`:

3a. Add `ScribeAppointment` to the existing import from `@/lib/scribe-queries`:

```ts
import {
  useCreateScribeSession,
  useScribeDepartments,
  useTodayAppointments,
  useUploadScribeAudio,
  useUploadScribeDocument,
  type ScribeAppointment,
} from "@/lib/scribe-queries";
```

3b. Extend `Props`:

```ts
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (sessionId: string) => void;
  initialSource?: EncounterSource;
  initialAudioFile?: File | null;
  initialDepartmentId?: string;
  initialAppointmentId?: string;
  initialAutoTranscribe?: boolean;
  extraAppointment?: ScribeAppointment;
}
```

3c. Update the destructured signature:

```ts
export function UploadModal({
  open,
  onClose,
  onCreated,
  initialSource = "record",
  initialAudioFile = null,
  initialDepartmentId,
  initialAppointmentId,
  initialAutoTranscribe,
  extraAppointment,
}: Props) {
```

3d. Add a pre-fill effect immediately after the existing `useEffect(() => { if (open) setEncounterSource(initialSource); }, [open, initialSource]);`:

```ts
  useEffect(() => {
    if (!open || !initialAudioFile) return;
    setEncounterSource("record");
    setFile(initialAudioFile);
    setRecordingUrl(URL.createObjectURL(initialAudioFile));
    setRecordingState("recorded");
    if (initialDepartmentId) setDepartmentId(initialDepartmentId);
    if (initialAppointmentId) setAppointmentId(initialAppointmentId);
    if (typeof initialAutoTranscribe === "boolean") setAutoTranscribe(initialAutoTranscribe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAudioFile]);
```

3e. Merge `extraAppointment` into the appointment list. Replace:

```ts
  const appointments = appointmentsQuery.data ?? [];
```

with:

```ts
  const fetchedAppointments = appointmentsQuery.data ?? [];
  const appointments =
    extraAppointment &&
    !fetchedAppointments.some((a) => a.appointment_id === extraAppointment.appointment_id)
      ? [extraAppointment, ...fetchedAppointments]
      : fetchedAppointments;
```

(The existing `selectedAppointment`/`patientId` lines below already read from `appointments`, so no further change is needed there.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/scribe/upload-modal.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full frontend test suite (no regressions)**

Run: `npm test`
Expected: PASS — all suites green, including the existing `record-view.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/scribe/upload-modal.tsx src/components/scribe/upload-modal.test.tsx
git commit -m "feat: add recovery pre-fill props to UploadModal"
```

---

### Task 4: Wire banner + recovery into `DesktopScribe`

**Files:**
- Modify: `frontend/src/pages/scribe.tsx`

**Interfaces:**
- Consumes: `useActiveRecordingDraft` (Task 1), `RecoveryBanner` (Task 2), the new `UploadModal` props (Task 3), and `buildRecordingDraftBlob` + `deleteActiveRecordingDraft` from `@/lib/recording-drafts`.
- Produces: no new exported symbols. `DesktopScribe` renders the banner above `StatsStrip` when a draft exists, and on Recover opens the existing `UploadModal` pre-filled with the recovered audio.

- [ ] **Step 1: Add imports**

At the top of `frontend/src/pages/scribe.tsx`, alongside the existing imports, add:

```ts
import { useActiveRecordingDraft } from "@/lib/use-active-recording-draft";
import { RecoveryBanner } from "@/components/scribe/recovery-banner";
import {
  buildRecordingDraftBlob,
  deleteActiveRecordingDraft,
} from "@/lib/recording-drafts";
import type { ScribeAppointment } from "@/lib/scribe-queries";
```

- [ ] **Step 2: Add recovery state and handlers inside `DesktopScribe`**

`DesktopScribe` already calls `const { user } = useAuth();`. Immediately after the existing `const [uploadOpen, setUploadOpen] = useState(false);` block, add:

```ts
  const {
    draft: recoveryDraft,
    refresh: refreshRecoveryDraft,
  } = useActiveRecordingDraft(user?.id ?? null);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [recoveryAppointment, setRecoveryAppointment] = useState<ScribeAppointment | null>(null);
  const [recoveryDept, setRecoveryDept] = useState("");
  const [recoveryAppointmentId, setRecoveryAppointmentId] = useState("");
  const [recoveryAutoTranscribe, setRecoveryAutoTranscribe] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const handleRecoverDraft = async () => {
    if (!recoveryDraft) return;
    setRecoveryError(null);
    try {
      const blob = await buildRecordingDraftBlob(recoveryDraft.draftId, recoveryDraft.mimeType);
      if (blob.size <= 0) {
        setRecoveryError("No saved audio was found for this interrupted recording.");
        return;
      }
      const file = new File([blob], `recovered-recording.${recoveryDraft.fileExtension}`, {
        type: recoveryDraft.mimeType,
      });
      setRecoveryFile(file);
      setRecoveryDept(recoveryDraft.departmentId);
      setRecoveryAppointmentId(recoveryDraft.appointmentId ?? "");
      setRecoveryAutoTranscribe(recoveryDraft.autoTranscribe);
      setRecoveryAppointment(
        recoveryDraft.appointmentId && recoveryDraft.patientId
          ? {
              appointment_id: recoveryDraft.appointmentId,
              patient_id: recoveryDraft.patientId,
              patient_name: recoveryDraft.patientName ?? recoveryDraft.patientId,
              time: recoveryDraft.appointmentTime ?? "",
              department_id: recoveryDraft.departmentId,
              status: "",
            }
          : null,
      );
      setUploadOpen(true);
    } catch {
      setRecoveryError("Unable to recover the interrupted recording.");
    }
  };

  const handleDiscardDraft = async () => {
    setRecoveryError(null);
    try {
      await deleteActiveRecordingDraft();
    } finally {
      refreshRecoveryDraft();
    }
  };

  const clearRecoveryState = () => {
    setRecoveryFile(null);
    setRecoveryAppointment(null);
    setRecoveryDept("");
    setRecoveryAppointmentId("");
  };
```

- [ ] **Step 3: Render the banner above `StatsStrip`**

In the inbox branch (the `<>...</>` that contains `janus-page-header` and `StatsStrip`), insert the banner between the `</div>` that closes `janus-page-header` and `<StatsStrip ... />`:

```tsx
          {recoveryDraft ? (
            <RecoveryBanner
              draft={recoveryDraft}
              error={recoveryError}
              onRecover={() => {
                void handleRecoverDraft();
              }}
              onDiscard={() => {
                void handleDiscardDraft();
              }}
            />
          ) : null}

          <StatsStrip stats={stats} />
```

- [ ] **Step 4: Pass recovery props to `UploadModal` and clean up on save/close**

Replace the existing `<UploadModal ... />` element with:

```tsx
      <UploadModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          clearRecoveryState();
        }}
        onCreated={(id) => {
          if (recoveryFile) {
            void deleteActiveRecordingDraft().finally(() => {
              clearRecoveryState();
              refreshRecoveryDraft();
            });
          }
          gotoSession(id);
        }}
        initialSource={uploadSource}
        initialAudioFile={recoveryFile}
        initialDepartmentId={recoveryDept}
        initialAppointmentId={recoveryAppointmentId}
        initialAutoTranscribe={recoveryAutoTranscribe}
        extraAppointment={recoveryAppointment ?? undefined}
      />
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run build`
Expected: PASS — `tsc -b` reports no errors and `vite build` completes.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 7: Manual verification (desktop)**

1. Start the app (`make dev-servers` from repo root), open the frontend in a desktop-width browser window (>640px), and log in.
2. Seed an interrupted draft: with the window narrowed to <640px, go to **Record**, start a recording, wait ~15s, then reload the page (do not save) to leave a draft in IndexedDB. Confirm via DevTools → Application → IndexedDB → `janus-recording-drafts` → `chunks` that chunks exist.
3. Widen the window past 640px and navigate to `/scribe`. Confirm the **Unsaved recording** banner appears with a duration.
4. Click **Recover recording**. Confirm the upload modal opens with the audio in the "recorded" state and (if the draft had an appointment) the patient/department pre-selected. Click **Save**.
5. Confirm a new session is created and the banner disappears. Reload `/scribe` and confirm the banner does not reappear (draft deleted).
6. Re-seed a draft (step 2) and instead click **Discard** in the banner; confirm the banner disappears and does not return after reload.

- [ ] **Step 8: Commit**

```bash
git add src/pages/scribe.tsx
git commit -m "feat: surface recording recovery banner on desktop scribe page"
```

---

## Self-Review notes

- **Spec coverage:** Detection hook (Task 1) ↔ spec §1; banner (Task 2) + wiring (Task 4) ↔ spec §2; `UploadModal` pre-fill incl. `extraAppointment` for the absent-appointment case ↔ spec §3 and the "No appointment in draft" behavior note; draft deleted only on Discard or successful save ↔ "Draft cleanup" note (handled in Task 4 `onDiscard`/`onCreated`).
- **Refinement vs spec:** Draft deletion on save is wired through `DesktopScribe`'s existing `onCreated` callback (recovery mode detected via `recoveryFile`) rather than a new `onRecoverySaved` modal prop, keeping `UploadModal` unaware of recovery. The banner is extracted into its own `RecoveryBanner` component for isolated testing. Both are consistent with the spec's intent.
