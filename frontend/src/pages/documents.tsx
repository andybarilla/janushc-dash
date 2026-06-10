import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useDocuments,
  useDocument,
  useUploadDocument,
  useDeleteDocument,
  useProcessDocument,
  type OcrDocument,
} from "@/lib/ocr-queries";
import {
  useScribeDepartments,
  useTodayAppointments,
} from "@/lib/scribe-queries";

export default function DocumentsPage() {
  const navigate = useNavigate();
  const { data: documents } = useDocuments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const upload = useUploadDocument();
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const created = await upload.mutateAsync(file);
    setSelectedId(created.id);
  };

  return (
    <div className="janus-scope" style={{ display: "flex", gap: "1.5rem", height: "100%", padding: "1.5rem" }}>
      {/* Left column */}
      <div style={{ width: "280px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Documents</h2>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
          >
            Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {documents?.map((doc) => (
            <button
              key={doc.id}
              onClick={() => setSelectedId(doc.id)}
              style={{
                textAlign: "left",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                border: selectedId === doc.id ? "1px solid var(--color-primary, #6366f1)" : "1px solid transparent",
                background: selectedId === doc.id ? "var(--color-primary-bg, rgba(99,102,241,0.1))" : "transparent",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {doc.original_filename}
              </span>
              <span style={{ fontSize: "0.75rem", opacity: 0.7, flexShrink: 0 }}>
                {statusLabel(doc.status)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right column */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedId ? (
          <DocumentDetail
            id={selectedId}
            onDeleted={() => setSelectedId(null)}
            onProcessed={(sid) => navigate(`/scribe/sessions/${sid}`)}
          />
        ) : (
          <p style={{ color: "var(--color-muted, #888)", marginTop: "0.5rem" }}>
            Select a document, or upload a new one.
          </p>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: OcrDocument["status"]): string {
  switch (status) {
    case "uploaded":
    case "extracting":
      return "Extracting…";
    case "extracted":
      return "Ready";
    case "error":
      return "Error";
  }
}

interface DocumentDetailProps {
  id: string;
  onDeleted: () => void;
  onProcessed: (scribeSessionId: string) => void;
}

function DocumentDetail({ id, onDeleted, onProcessed }: DocumentDetailProps) {
  const { data: doc } = useDocument(id);
  const deleteMut = useDeleteDocument();
  const [showProcessForm, setShowProcessForm] = useState(false);

  if (!doc) return <p>Loading…</p>;

  const downloadText = () => {
    if (!doc.extracted_text) return;
    const blob = new Blob([doc.extracted_text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.original_filename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
        <h3 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {doc.original_filename}
        </h3>
        <button
          className="btn btn-danger btn-sm"
          onClick={async () => {
            await deleteMut.mutateAsync(id);
            onDeleted();
          }}
          disabled={deleteMut.isPending}
        >
          Delete
        </button>
      </div>

      {doc.status === "error" && (
        <div role="alert" style={{ color: "var(--color-danger, #ef4444)", padding: "0.75rem", borderRadius: "0.375rem", border: "1px solid var(--color-danger, #ef4444)" }}>
          {doc.error_message ?? "An error occurred."}
        </div>
      )}

      {(doc.status === "uploaded" || doc.status === "extracting") && (
        <p style={{ opacity: 0.7 }}>Extracting text…</p>
      )}

      {doc.status === "extracted" && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard.writeText(doc.extracted_text ?? "")}
            >
              Copy
            </button>
            <button className="btn btn-secondary btn-sm" onClick={downloadText}>
              Download
            </button>
            <a
              href={`/api/ocr/documents/${id}/file`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              View original
            </a>
            {doc.scribe_session_id ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onProcessed(doc.scribe_session_id!)}
              >
                Open note
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowProcessForm((v) => !v)}
              >
                Process
              </button>
            )}
          </div>

          {showProcessForm && (
            <ProcessForm
              documentId={id}
              onProcessed={(sid) => {
                setShowProcessForm(false);
                onProcessed(sid);
              }}
            />
          )}

          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "0.875rem", lineHeight: 1.6 }}>
            {doc.extracted_text}
          </pre>
        </>
      )}
    </div>
  );
}

interface ProcessFormProps {
  documentId: string;
  onProcessed: (scribeSessionId: string) => void;
}

function ProcessForm({ documentId, onProcessed }: ProcessFormProps) {
  const processMut = useProcessDocument();
  const [departmentId, setDepartmentId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");

  const departments = useScribeDepartments();
  const appointments = useTodayAppointments(departmentId);

  const selectedAppointment = appointments.data?.find(
    (a) => a.appointment_id === appointmentId,
  );
  const patientId = selectedAppointment?.patient_id ?? "";

  const canSubmit = !!departmentId && !!appointmentId && !!patientId && !processMut.isPending;

  const onSubmit = async () => {
    const result = await processMut.mutateAsync({
      id: documentId,
      patient_id: patientId,
      appointment_id: appointmentId,
      department_id: departmentId,
    });
    onProcessed(result.scribe_session_id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem", border: "1px solid var(--color-border, #333)", borderRadius: "0.5rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label style={{ fontSize: "0.875rem" }}>Department</label>
        <select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setAppointmentId("");
          }}
          style={{ padding: "0.375rem 0.5rem", borderRadius: "0.375rem" }}
        >
          <option value="">Select department…</option>
          {departments.data?.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label style={{ fontSize: "0.875rem" }}>Appointment</label>
        <select
          value={appointmentId}
          onChange={(e) => setAppointmentId(e.target.value)}
          disabled={!departmentId}
          style={{ padding: "0.375rem 0.5rem", borderRadius: "0.375rem" }}
        >
          <option value="">Select appointment…</option>
          {appointments.data?.map((appt) => (
            <option key={appt.appointment_id} value={appt.appointment_id}>
              {appt.time} — {appt.patient_name}
            </option>
          ))}
        </select>
      </div>

      {processMut.isError && (
        <div role="alert" style={{ color: "var(--color-danger, #ef4444)", fontSize: "0.875rem" }}>
          Processing failed.
        </div>
      )}

      <button
        className="btn btn-primary btn-sm"
        onClick={onSubmit}
        disabled={!canSubmit}
      >
        {processMut.isPending ? "Processing…" : "Process into note"}
      </button>
    </div>
  );
}
