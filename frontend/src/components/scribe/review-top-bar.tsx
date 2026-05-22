import { ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type { StatusDef } from "./types";
import { StatusPill } from "./status-pill";

interface Props {
  session: ScribeSessionDetail;
  status: StatusDef;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onDelete: () => void;
}

export function ReviewTopBar({
  session,
  status,
  onBack,
  onPrev,
  onNext,
  onDelete,
}: Props) {
  return (
    <div className="janus-review-topbar">
      <button
        type="button"
        className="janus-btn janus-btn-ghost janus-btn-sm"
        onClick={onBack}
      >
        <ArrowLeft />
        Back to inbox
      </button>
      <div className="janus-review-identity">
        <h2>{session.patient_id}</h2>
        <span>
          Encounter {session.encounter_id} · Dept {session.department_id}
        </span>
      </div>
      <StatusPill status={status} large />
      <div className="janus-review-nav">
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          disabled={!onPrev}
          onClick={onPrev ?? undefined}
        >
          <ChevronLeft />
          Prev
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          disabled={!onNext}
          onClick={onNext ?? undefined}
        >
          Next
          <ChevronRight />
        </button>
      </div>
      <button
        type="button"
        className="janus-btn janus-btn-danger-ghost janus-btn-sm"
        onClick={onDelete}
      >
        <Trash2 />
        Delete
      </button>
    </div>
  );
}
