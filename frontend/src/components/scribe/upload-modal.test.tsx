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

describe("UploadModal state reset on close", () => {
  it("clears stale recovered audio when modal is closed and reopened without initialAudioFile", async () => {
    const recoveredFile = new File([new Blob(["x"])], "recovered-recording.webm", { type: "audio/webm" });
    const { rerender } = render(
      <UploadModal
        open
        onClose={vi.fn()}
        initialAudioFile={recoveredFile}
        initialDepartmentId="dept-1"
        initialAppointmentId="appt-9"
        extraAppointment={extraAppointment}
      />,
    );

    // Confirm recovered state is shown
    expect(await screen.findByText("Recording ready to upload")).toBeInTheDocument();

    // Close the modal
    rerender(
      <UploadModal
        open={false}
        onClose={vi.fn()}
        initialAudioFile={recoveredFile}
        initialDepartmentId="dept-1"
        initialAppointmentId="appt-9"
        extraAppointment={extraAppointment}
      />,
    );

    // Reopen without the recovered file (normal open)
    rerender(
      <UploadModal
        open
        onClose={vi.fn()}
        initialAudioFile={null}
        extraAppointment={extraAppointment}
      />,
    );

    // Stale "recorded" state must not be present
    await waitFor(() => {
      expect(screen.queryByText("Recording ready to upload")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Ready to record")).toBeInTheDocument();
  });
});

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
