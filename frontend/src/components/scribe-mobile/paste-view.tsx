import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import {
  useCreateScribeSession,
  useScribeDepartments,
  useSubmitTranscript,
  useTodayAppointments,
} from "@/lib/scribe-queries";

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
  const [department, setDepartment] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createSession = useCreateScribeSession();
  const submitTranscript = useSubmitTranscript();
  const departmentsQuery = useScribeDepartments();
  const appointmentsQuery = useTodayAppointments(department);

  useEffect(() => {
    const first = departmentsQuery.data?.[0];
    if (!department && first) {
      setDepartment(first.id);
    }
  }, [department, departmentsQuery.data]);

  const appointments = appointmentsQuery.data ?? [];
  const selectedAppointment = appointments.find(
    (a) => a.appointment_id === appointmentId,
  );
  const patientId = selectedAppointment?.patient_id ?? "";

  const busy = createSession.isPending || submitTranscript.isPending;
  const canSubmit = !!transcript.trim() && !!appointmentId && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!appointmentId || !patientId) return;
    setError(null);
    try {
      const session = await createSession.mutateAsync({
        patient_id: patientId,
        appointment_id: appointmentId,
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
          <label className="field-label" htmlFor="m-paste-dept">Department</label>
          <select
            id="m-paste-dept"
            className="field"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setAppointmentId("");
            }}
            disabled={busy || departmentsQuery.isLoading}
          >
            {departmentsQuery.isLoading ? (
              <option value="">Loading…</option>
            ) : (
              departmentsQuery.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))
            )}
          </select>
          {departmentsQuery.isError ? (
            <div className="m-rec-error">Could not load departments.</div>
          ) : null}

          <label className="field-label" htmlFor="m-paste-patient">Patient</label>
          <select
            id="m-paste-patient"
            className="field"
            value={appointmentId}
            onChange={(e) => setAppointmentId(e.target.value)}
            disabled={busy || !department || appointmentsQuery.isLoading}
          >
            <option value="">
              {appointmentsQuery.isLoading
                ? "Loading…"
                : appointments.length === 0
                  ? "No appointments booked today"
                  : "Select patient…"}
            </option>
            {appointments.map((a) => (
              <option key={a.appointment_id} value={a.appointment_id}>
                {a.time} · {a.patient_name}
              </option>
            ))}
          </select>
          {appointmentsQuery.isError ? (
            <div className="m-rec-error">Could not load appointments.</div>
          ) : null}

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
