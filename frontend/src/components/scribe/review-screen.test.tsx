import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./review-screen";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type { Approvals } from "./types";

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
    notFound: false,
    canApprove: true,
    onBack: noop,
    onPrev: null,
    onNext: noop,
    onApprove: noop,
    onApproveAll: noop,
    onReject: noop,
    onDelete: noop,
    onSend: noop,
    onSaveSection: noop,
    onOpenNotes: noop,
    onAddNoteForSection: noop,
    onRetry: noop,
  };
}

afterEach(() => cleanup());

describe("ReviewScreen", () => {
  it("renders the encounter identity and section content", () => {
    render(<ReviewScreen {...baseProps()} />);
    expect(screen.getByText("patient-a")).toBeInTheDocument();
    expect(screen.getByText("HPI")).toBeInTheDocument();
    expect(screen.getByText("HPI body text")).toBeInTheDocument();
  });

  it("disables Prev when onPrev is null", () => {
    render(<ReviewScreen {...baseProps()} />);
    expect(screen.getByRole("button", { name: /Prev/ })).toBeDisabled();
  });

  it("calls onNext when Next is clicked", () => {
    const onNext = vi.fn();
    render(<ReviewScreen {...baseProps()} onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onNext).toHaveBeenCalled();
  });

  it("calls onBack when Back to inbox is clicked", () => {
    const onBack = vi.fn();
    render(<ReviewScreen {...baseProps()} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to inbox/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows a not-found state with a back action", () => {
    const onBack = vi.fn();
    render(
      <ReviewScreen
        {...baseProps()}
        session={null}
        statusId={null}
        notFound={true}
        onBack={onBack}
      />,
    );
    expect(
      screen.getByText("This encounter could not be found."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to inbox/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("opens an enlarged textarea when a section is edited", () => {
    render(<ReviewScreen {...baseProps()} />);
    fireEvent.click(screen.getAllByTitle("Edit this section")[0]!);
    const textarea = screen.getByDisplayValue("HPI body text");
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).rows).toBe(18);
  });
});
