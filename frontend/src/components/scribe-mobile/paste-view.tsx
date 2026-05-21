import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useCreateScribeSession, useSubmitTranscript } from "@/lib/scribe-queries";

function apiErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message.trim() : null;
  }
  return null;
}

interface Props {
  onBack: () => void;
  onSaved: (sessionId: string) => void;
}

export function MPasteView({ onBack, onSaved }: Props) {
  const [patientId, setPatientId] = useState("");
  const [department, setDepartment] = useState("dept-1");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createSession = useCreateScribeSession();
  const submitTranscript = useSubmitTranscript();

  const busy = createSession.isPending || submitTranscript.isPending;
  const canSubmit = !!transcript.trim() && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    const patient = patientId.trim() || `mobile-${Date.now()}`;
    try {
      const session = await createSession.mutateAsync({
        patient_id: patient,
        encounter_id: `enc-${patient}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
        department_id: department,
      });
      await submitTranscript.mutateAsync({ id: session.id, transcript });
      onSaved(session.id);
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Failed to process transcript.");
    }
  };

  return (
    <>
      <div className="m-detail-topbar">
        <button
          type="button"
          className="m-back"
          onClick={onBack}
          disabled={busy}
        >
          <ChevronLeft />
          <span>Home</span>
        </button>
        <div className="title">{busy ? "Processing…" : "Paste transcript"}</div>
        <span style={{ width: 38, flexShrink: 0 }} />
      </div>

      <div className="m-record-stage">
        <div className="m-record-form">
          <label className="field-label" htmlFor="m-paste-patient">Patient</label>
          <input
            id="m-paste-patient"
            className="field"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            placeholder="Patient ID"
            autoComplete="off"
            disabled={busy}
          />
          <label className="field-label" htmlFor="m-paste-dept">Department</label>
          <select
            id="m-paste-dept"
            className="field"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={busy}
          >
            <option value="dept-1">Department 1</option>
            <option value="dept-2">Department 2</option>
          </select>
          <label className="field-label" htmlFor="m-paste-transcript">Transcript</label>
          <textarea
            id="m-paste-transcript"
            className="field"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the encounter transcript here…"
            rows={10}
            disabled={busy}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div className="m-record-center">
          {error ? <div className="m-rec-error">{error}</div> : null}
          <div className="m-record-actions">
            <button
              type="button"
              className="m-record-save"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {busy ? "Processing…" : "Process transcript"}
            </button>
          </div>
          {!busy ? (
            <div className="m-rec-detail">
              The transcript will be sent directly to AI extraction — no transcription step needed.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
