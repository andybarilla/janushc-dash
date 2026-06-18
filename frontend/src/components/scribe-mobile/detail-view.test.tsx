import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type { Approvals } from "@/components/scribe/types";
import { MDetailView } from "./detail-view";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

function makeSession(): ScribeSessionDetail {
  return {
    id: "s1",
    patient_id: "patient-a",
    encounter_id: "enc-1",
    department_id: "1",
    status: "ready",
    created_at: "2026-05-21T10:00:00Z",
    approved_count: 0,
    transcript: "transcript text here",
    ai_output: {
      hpi: "HPI body text",
      assessment_plan: "Plan body text",
      physical_exam: "Exam body text",
      diagnoses_labs: [],
    },
    sections: {
      hpi: { state: "pending", content: "HPI body text" },
      plan: { state: "pending", content: "Plan body text" },
      exam: { state: "pending", content: "Exam body text" },
      labs: { state: "pending", content: [] },
    },
    audio_available: false,
  };
}

const approvals: Approvals = { hpi: false, plan: false, exam: false, labs: false };

function noop() {}

function baseProps() {
  return {
    session: makeSession(),
    statusId: "ready" as const,
    approvals,
    notes: [],
    loading: false,
    canApprove: true,
    onBack: noop,
    onDelete: noop,
    onApprove: noop,
    onApproveAll: noop,
    onSend: noop,
    onOpenNotes: noop,
    onAddNoteForSection: noop,
    onRetry: noop,
    onUpdatePatientId: noop,
    updatingPatientId: false,
  };
}

afterEach(() => cleanup());

describe("MDetailView patient id editing", () => {
  it("saves a trimmed patient id from the mobile detail header", () => {
    const onUpdatePatientId = vi.fn();
    render(<MDetailView {...baseProps()} onUpdatePatientId={onUpdatePatientId} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit patient ID" }));
    fireEvent.change(screen.getByLabelText("Patient ID"), {
      target: { value: "  mobile-patient  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save patient ID" }));
    expect(onUpdatePatientId).toHaveBeenCalledWith("mobile-patient");
  });

  it("cancels mobile patient id editing without saving", () => {
    const onUpdatePatientId = vi.fn();
    render(<MDetailView {...baseProps()} onUpdatePatientId={onUpdatePatientId} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit patient ID" }));
    fireEvent.change(screen.getByLabelText("Patient ID"), {
      target: { value: "mobile-patient" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel patient ID edit" }));
    expect(onUpdatePatientId).not.toHaveBeenCalled();
    expect(screen.getAllByText("patient-a").length).toBeGreaterThan(0);
  });

  it.each([
    ["sent", { sent_to_ehr_at: "2026-06-17T12:00:00Z" }],
    ["rejected", { rejected_at: "2026-06-17T12:00:00Z" }],
  ])("disables mobile patient id editing for %s sessions", (_name, overrides) => {
    render(<MDetailView {...baseProps()} session={{ ...makeSession(), ...overrides }} />);
    expect(screen.getByRole("button", { name: "Edit patient ID" })).toBeDisabled();
  });
});
