import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
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
  onUpdatePatientId: (patientId: string) => void;
  updatingPatientId: boolean;
}

export function ReviewTopBar({
  session,
  status,
  onBack,
  onPrev,
  onNext,
  onDelete,
  onUpdatePatientId,
  updatingPatientId,
}: Props) {
  const [editingPatientId, setEditingPatientId] = useState(false);
  const [draftPatientId, setDraftPatientId] = useState(session.patient_id);
  const patientIdLocked = Boolean(session.sent_to_ehr_at || session.rejected_at);
  const trimmedPatientId = draftPatientId.trim();
  const patientIdSaveDisabled =
    patientIdLocked ||
    updatingPatientId ||
    !trimmedPatientId ||
    trimmedPatientId === session.patient_id;

  useEffect(() => {
    if (editingPatientId) return;
    setDraftPatientId(session.patient_id);
  }, [editingPatientId, session.patient_id]);

  const startPatientIdEdit = () => {
    if (patientIdLocked || updatingPatientId) return;
    setDraftPatientId(session.patient_id);
    setEditingPatientId(true);
  };

  const cancelPatientIdEdit = () => {
    setDraftPatientId(session.patient_id);
    setEditingPatientId(false);
  };

  const savePatientId = () => {
    if (patientIdSaveDisabled) return;
    onUpdatePatientId(trimmedPatientId);
    setEditingPatientId(false);
  };

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
        {editingPatientId ? (
          <div className="janus-patient-id-edit">
            <input
              aria-label="Patient ID"
              className="janus-patient-id-input"
              disabled={patientIdLocked || updatingPatientId}
              value={draftPatientId}
              onChange={(event) => setDraftPatientId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") savePatientId();
                if (event.key === "Escape") cancelPatientIdEdit();
              }}
            />
            <button
              type="button"
              className="janus-btn janus-btn-primary janus-btn-sm"
              aria-label="Save patient ID"
              disabled={patientIdSaveDisabled}
              onClick={savePatientId}
            >
              <Check />
            </button>
            <button
              type="button"
              className="janus-btn janus-btn-ghost janus-btn-sm"
              aria-label="Cancel patient ID edit"
              onClick={cancelPatientIdEdit}
            >
              <X />
            </button>
          </div>
        ) : (
          <div className="janus-patient-id-row">
            <h2>{session.patient_id}</h2>
            <button
              type="button"
              className="janus-btn janus-btn-ghost janus-btn-sm"
              aria-label="Edit patient ID"
              disabled={patientIdLocked || updatingPatientId}
              onClick={startPatientIdEdit}
            >
              <Pencil />
            </button>
          </div>
        )}
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
