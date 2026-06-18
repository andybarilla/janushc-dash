import { useState } from "react";
import { Building2, Check, Clock, FileText, Pencil, UserRound, X } from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import { STATUS, wordCount } from "@/components/scribe/status";
import type { StatusId } from "@/components/scribe/types";
import { MStatusPill } from "./status-pill";

interface Props {
  session: ScribeSessionDetail;
  statusId: StatusId;
  onUpdatePatientId: (patientId: string) => void;
  updatingPatientId: boolean;
}

function fmtDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MEncounterHeader({
  session,
  statusId,
  onUpdatePatientId,
  updatingPatientId,
}: Props) {
  const [editingPatientId, setEditingPatientId] = useState(false);
  const [patientIdDraft, setPatientIdDraft] = useState(session.patient_id);
  const words = wordCount(session.transcript);
  const status = STATUS[statusId];
  const patientIdLocked = Boolean(session.sent_to_ehr_at || session.rejected_at);
  const trimmedPatientId = patientIdDraft.trim();
  const canSavePatientId =
    trimmedPatientId.length > 0 && trimmedPatientId !== session.patient_id;

  const savePatientId = () => {
    if (!canSavePatientId || updatingPatientId) return;
    onUpdatePatientId(trimmedPatientId);
    setEditingPatientId(false);
  };

  const startPatientIdEdit = () => {
    if (patientIdLocked || updatingPatientId) return;
    setPatientIdDraft(session.patient_id);
    setEditingPatientId(true);
  };

  const cancelPatientIdEdit = () => {
    setPatientIdDraft(session.patient_id);
    setEditingPatientId(false);
  };

  return (
    <div className="m-detail-head">
      <div className="m-detail-titlerow">
        <div>
          {editingPatientId ? (
            <div className="m-patient-id-row">
              <label className="m-sr-only" htmlFor="m-patient-id-input">
                Patient ID
              </label>
              <input
                id="m-patient-id-input"
                className="m-patient-id-input"
                value={patientIdDraft}
                onChange={(event) => setPatientIdDraft(event.target.value)}
                disabled={updatingPatientId}
                autoFocus
              />
              <button
                type="button"
                className="m-icon-btn"
                aria-label="Save patient ID"
                disabled={!canSavePatientId || updatingPatientId}
                onClick={savePatientId}
              >
                <Check />
              </button>
              <button
                type="button"
                className="m-icon-btn"
                aria-label="Cancel patient ID edit"
                disabled={updatingPatientId}
                onClick={cancelPatientIdEdit}
              >
                <X />
              </button>
            </div>
          ) : (
            <div className="m-patient-id-row">
              <h2 className="m-patient-name">{session.patient_id}</h2>
              <button
                type="button"
                className="m-icon-btn m-patient-id-edit"
                aria-label="Edit patient ID"
                disabled={patientIdLocked || updatingPatientId}
                onClick={startPatientIdEdit}
              >
                <Pencil />
              </button>
            </div>
          )}
          <p className="m-patient-sub">Encounter {session.encounter_id}</p>
        </div>
        <MStatusPill status={status} large />
      </div>
      <div className="m-detail-meta">
        <span>
          <UserRound />
          Provider not on file
        </span>
        {session.department_id ? (
          <span>
            <Building2 />
            Dept {session.department_id}
          </span>
        ) : null}
        <span>
          <Clock />
          {fmtDuration(undefined)}
        </span>
        {words > 0 ? (
          <span>
            <FileText />
            {words.toLocaleString()} w
          </span>
        ) : null}
      </div>
    </div>
  );
}
