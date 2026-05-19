import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MRecordView } from "./record-view";
import {
  ACTIVE_RECORDING_DRAFT_ID,
  RECORDING_CHUNK_MS,
} from "@/lib/recording-drafts";

const mocks = vi.hoisted(() => ({
  createActiveRecordingDraft: vi.fn(),
  saveRecordingDraftChunk: vi.fn(),
  updateActiveRecordingDraftMetadata: vi.fn(),
  useCreateScribeSession: vi.fn(),
  useUploadScribeAudio: vi.fn(),
}));

vi.mock("@/lib/recording-drafts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recording-drafts")>(
    "@/lib/recording-drafts",
  );
  return {
    ...actual,
    createActiveRecordingDraft: mocks.createActiveRecordingDraft,
    saveRecordingDraftChunk: mocks.saveRecordingDraftChunk,
    updateActiveRecordingDraftMetadata: mocks.updateActiveRecordingDraftMetadata,
  };
});

vi.mock("@/lib/scribe-queries", () => ({
  useCreateScribeSession: mocks.useCreateScribeSession,
  useUploadScribeAudio: mocks.useUploadScribeAudio,
}));

type DataHandler = ((event: BlobEvent) => void) | null;
type StopHandler = (() => void) | null;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string): boolean => mimeType === "audio/webm;codecs=opus");

  mimeType: string;
  state: RecordingState = "inactive";
  ondataavailable: DataHandler = null;
  onstop: StopHandler = null;
  start = vi.fn((timeslice?: number): void => {
    this.state = "recording";
    this.startTimeslice = timeslice;
  });
  stop = vi.fn((): void => {
    this.state = "inactive";
    this.onstop?.();
  });
  startTimeslice: number | undefined;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }
}

function renderRecordView(): void {
  render(<MRecordView onBack={vi.fn()} onSaved={vi.fn()} />);
}

async function startRecording(): Promise<FakeMediaRecorder> {
  renderRecordView();
  fireEvent.change(screen.getByLabelText("Patient"), { target: { value: "patient-1" } });
  fireEvent.click(screen.getByLabelText("Start recording"));
  await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
  await waitFor(() => expect(FakeMediaRecorder.instances[0].start).toHaveBeenCalled());
  return FakeMediaRecorder.instances[0];
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported.mockClear();
  mocks.createActiveRecordingDraft.mockResolvedValue({
    draftId: ACTIVE_RECORDING_DRAFT_ID,
    mimeType: "audio/webm;codecs=opus",
    fileExtension: "webm",
    patientId: "patient-1",
    departmentId: "dept-1",
    autoTranscribe: true,
    startedAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    elapsedSeconds: 0,
    nextChunkIndex: 0,
  });
  mocks.saveRecordingDraftChunk.mockResolvedValue(undefined);
  mocks.updateActiveRecordingDraftMetadata.mockResolvedValue(undefined);
  mocks.useCreateScribeSession.mockReturnValue({ mutateAsync: vi.fn() });
  mocks.useUploadScribeAudio.mockReturnValue({ mutateAsync: vi.fn() });

  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    writable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: (): MediaStreamTrack[] => [{ stop: vi.fn() } as unknown as MediaStreamTrack],
      }),
    },
  });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:recording"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MRecordView recording drafts", () => {
  it("creates an active draft with recording metadata when recording starts", async () => {
    await startRecording();

    expect(mocks.createActiveRecordingDraft).toHaveBeenCalledWith({
      mimeType: "audio/webm;codecs=opus",
      fileExtension: "webm",
      patientId: "patient-1",
      departmentId: "dept-1",
      autoTranscribe: true,
      elapsedSeconds: 0,
    });
  });

  it("starts MediaRecorder with the recording chunk timeslice", async () => {
    const recorder = await startRecording();

    expect(recorder.start).toHaveBeenCalledWith(RECORDING_CHUNK_MS);
  });

  it("saves non-empty recording chunks with increasing chunk indexes", async () => {
    const recorder = await startRecording();
    const firstBlob = new Blob(["first"], { type: "audio/webm" });
    const secondBlob = new Blob(["second"], { type: "audio/webm" });

    recorder.ondataavailable?.({ data: firstBlob } as BlobEvent);
    recorder.ondataavailable?.({ data: secondBlob } as BlobEvent);

    expect(mocks.saveRecordingDraftChunk).toHaveBeenNthCalledWith(
      1,
      ACTIVE_RECORDING_DRAFT_ID,
      0,
      firstBlob,
    );
    expect(mocks.saveRecordingDraftChunk).toHaveBeenNthCalledWith(
      2,
      ACTIVE_RECORDING_DRAFT_ID,
      1,
      secondBlob,
    );
  });

  it("continues recording and shows a storage warning when chunk saving fails", async () => {
    mocks.saveRecordingDraftChunk.mockRejectedValueOnce(new Error("quota"));
    const recorder = await startRecording();

    recorder.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) } as BlobEvent);

    expect(await screen.findByText("Recording is continuing, but local recovery storage is unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Recording is being saved locally as you go. Keep this page open for best results.")).toBeInTheDocument();
    expect(recorder.state).toBe("recording");
  });
});
