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
