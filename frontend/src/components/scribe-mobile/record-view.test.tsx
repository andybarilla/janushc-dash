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
  getActiveRecordingDraft: vi.fn(),
  buildRecordingDraftBlob: vi.fn(),
  deleteActiveRecordingDraft: vi.fn(),
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
    getActiveRecordingDraft: mocks.getActiveRecordingDraft,
    buildRecordingDraftBlob: mocks.buildRecordingDraftBlob,
    deleteActiveRecordingDraft: mocks.deleteActiveRecordingDraft,
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

function renderRecordView(
  onSaved: (sessionId: string) => void = vi.fn(),
  onBack: () => void = vi.fn(),
): { onSaved: (sessionId: string) => void; onBack: () => void } {
  render(<MRecordView onBack={onBack} onSaved={onSaved} />);
  return { onSaved, onBack };
}

function recorderAt(index: number): FakeMediaRecorder {
  const recorder = FakeMediaRecorder.instances[index];
  if (!recorder) {
    throw new Error(`Expected media recorder at index ${index}`);
  }
  return recorder;
}

function invocationCallOrderAt(mock: { mock: { invocationCallOrder: number[] } }, index: number): number {
  const callOrder = mock.mock.invocationCallOrder[index];
  if (callOrder === undefined) {
    throw new Error(`Expected invocation call order at index ${index}`);
  }
  return callOrder;
}

async function stopRecordingForReview(): Promise<void> {
  const recorder = await startRecording();
  recorder.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) } as BlobEvent);
  recorder.stop();
  await screen.findByText("Review recording");
}

async function startRecording(): Promise<FakeMediaRecorder> {
  renderRecordView();
  fireEvent.change(await screen.findByLabelText("Patient"), { target: { value: "patient-1" } });
  fireEvent.click(screen.getByLabelText("Start recording"));
  await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
  const recorder = recorderAt(0);
  await waitFor(() => expect(recorder.start).toHaveBeenCalled());
  return recorder;
}

let trackStop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
  mocks.getActiveRecordingDraft.mockResolvedValue(null);
  mocks.buildRecordingDraftBlob.mockResolvedValue(new Blob(["recovered"], { type: "audio/webm" }));
  mocks.deleteActiveRecordingDraft.mockResolvedValue(undefined);
  mocks.useCreateScribeSession.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ id: "session-1" }) });
  mocks.useUploadScribeAudio.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined) });

  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    writable: true,
    value: FakeMediaRecorder,
  });
  trackStop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: (): MediaStreamTrack[] => [{ stop: trackStop } as unknown as MediaStreamTrack],
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
  it("shows recovery controls when an active draft exists", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValueOnce({
      draftId: ACTIVE_RECORDING_DRAFT_ID,
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-2",
      departmentId: "dept-2",
      autoTranscribe: false,
      startedAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:01:15.000Z",
      elapsedSeconds: 75,
      nextChunkIndex: 3,
    });

    renderRecordView();

    expect(await screen.findByText("Interrupted recording found")).toBeInTheDocument();
    expect(screen.getByText("We saved audio from a previous recording on this device. Review and save it, or discard it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recover recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Start recording")).not.toBeInTheDocument();
  });

  it("recovers an active draft into review state", async () => {
    const recoveredBlob = new Blob(["recovered"], { type: "audio/webm" });
    const uploadAudio = vi.fn().mockResolvedValue(undefined);
    mocks.getActiveRecordingDraft.mockResolvedValueOnce({
      draftId: ACTIVE_RECORDING_DRAFT_ID,
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-2",
      departmentId: "dept-2",
      autoTranscribe: false,
      startedAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:01:15.000Z",
      elapsedSeconds: 75,
      nextChunkIndex: 3,
    });
    mocks.buildRecordingDraftBlob.mockResolvedValueOnce(recoveredBlob);
    mocks.useUploadScribeAudio.mockReturnValue({ mutateAsync: uploadAudio });

    renderRecordView();
    fireEvent.click(await screen.findByRole("button", { name: "Recover recording" }));

    expect(await screen.findByText("Recovered from local device storage. Please review before saving.")).toBeInTheDocument();
    expect(mocks.buildRecordingDraftBlob).toHaveBeenCalledWith(ACTIVE_RECORDING_DRAFT_ID, "audio/webm");
    expect(URL.createObjectURL).toHaveBeenCalledWith(recoveredBlob);
    expect(screen.getByText("Recorded 01:15")).toBeInTheDocument();
    expect(screen.getByText(/patient-2 · dept-2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save recording only" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save recording only" }));
    await waitFor(() => expect(uploadAudio).toHaveBeenCalled());
    const firstUploadCall = uploadAudio.mock.calls[0];
    if (!firstUploadCall) {
      throw new Error("Expected upload audio to be called");
    }
    const uploadedFile = firstUploadCall[0].file as File;
    expect(uploadedFile.name).toBe("mobile-recording-recovered.webm");
    expect(uploadedFile.type).toBe("audio/webm");
  });

  it("discards an active draft and returns to normal idle controls", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValueOnce({
      draftId: ACTIVE_RECORDING_DRAFT_ID,
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-2",
      departmentId: "dept-2",
      autoTranscribe: true,
      startedAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:01:15.000Z",
      elapsedSeconds: 75,
      nextChunkIndex: 3,
    });

    renderRecordView();
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(mocks.deleteActiveRecordingDraft).toHaveBeenCalled());
    expect(await screen.findByLabelText("Start recording")).toBeInTheDocument();
    expect(screen.queryByText("Interrupted recording found")).not.toBeInTheDocument();
  });

  it("keeps discard available when recovering a draft fails", async () => {
    mocks.getActiveRecordingDraft.mockResolvedValueOnce({
      draftId: ACTIVE_RECORDING_DRAFT_ID,
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-2",
      departmentId: "dept-2",
      autoTranscribe: true,
      startedAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:01:15.000Z",
      elapsedSeconds: 75,
      nextChunkIndex: 3,
    });
    mocks.buildRecordingDraftBlob.mockRejectedValueOnce(new Error("draft chunks unavailable"));

    renderRecordView();
    fireEvent.click(await screen.findByRole("button", { name: "Recover recording" }));

    expect(await screen.findByText("draft chunks unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

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

  it("deletes the active draft after upload succeeds before reporting saved", async () => {
    const onSaved = vi.fn();
    const uploadAudio = vi.fn().mockResolvedValue(undefined);
    mocks.useUploadScribeAudio.mockReturnValue({ mutateAsync: uploadAudio });
    renderRecordView(onSaved);
    fireEvent.change(await screen.findByLabelText("Patient"), { target: { value: "patient-1" } });
    fireEvent.click(screen.getByLabelText("Start recording"));
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    const recorder = recorderAt(0);
    recorder.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) } as BlobEvent);
    recorder.stop();
    fireEvent.click(await screen.findByRole("button", { name: "Save & queue for processing" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("session-1"));
    expect(uploadAudio).toHaveBeenCalled();
    expect(mocks.deleteActiveRecordingDraft).toHaveBeenCalledTimes(1);
    expect(invocationCallOrderAt(uploadAudio, 0)).toBeLessThan(invocationCallOrderAt(mocks.deleteActiveRecordingDraft, 0));
    expect(invocationCallOrderAt(mocks.deleteActiveRecordingDraft, 0)).toBeLessThan(invocationCallOrderAt(onSaved, 0));
  });

  it("does not delete the active draft when upload fails and leaves review visible", async () => {
    mocks.useUploadScribeAudio.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(new Error("upload failed")) });
    await stopRecordingForReview();

    fireEvent.click(screen.getByRole("button", { name: "Save & queue for processing" }));

    expect(await screen.findByText("upload failed")).toBeInTheDocument();
    expect(screen.getByText("Review recording")).toBeInTheDocument();
    expect(mocks.deleteActiveRecordingDraft).not.toHaveBeenCalled();
  });

  it("deletes the active draft and navigates back when discarding from review", async () => {
    const onBack = vi.fn();
    renderRecordView(vi.fn(), onBack);
    fireEvent.click(await screen.findByLabelText("Start recording"));
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    const recorder = recorderAt(0);
    recorder.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) } as BlobEvent);
    recorder.stop();

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(mocks.deleteActiveRecordingDraft).toHaveBeenCalledTimes(1));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("deletes the active draft and navigates back without showing review when backing out while recording", async () => {
    const onBack = vi.fn();
    renderRecordView(vi.fn(), onBack);
    fireEvent.click(await screen.findByLabelText("Start recording"));
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    const recorder = recorderAt(0);

    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    await waitFor(() => expect(mocks.deleteActiveRecordingDraft).toHaveBeenCalledTimes(1));
    expect(recorder.stop).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
    expect(screen.queryByText("Review recording")).not.toBeInTheDocument();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("deletes the previous draft before starting a replacement recording", async () => {
    await stopRecordingForReview();

    fireEvent.click(screen.getByRole("button", { name: "Re-record" }));

    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(2));
    expect(mocks.deleteActiveRecordingDraft).toHaveBeenCalledTimes(1);
    expect(invocationCallOrderAt(mocks.deleteActiveRecordingDraft, 0)).toBeLessThan(
      invocationCallOrderAt(mocks.createActiveRecordingDraft, 1),
    );
  });
});
