import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import {
  useCreateScribeSession,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";

const ACCEPTED_FORMATS = ".mp3,.m4a,.wav,.webm,.ogg";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (sessionId: string) => void;
}

export function UploadModal({ open, onClose, onCreated }: Props) {
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();

  if (!open) return null;

  const busy = createSession.isPending || uploadAudio.isPending;
  const error =
    (createSession.error instanceof Error && createSession.error.message) ||
    (uploadAudio.error instanceof Error && uploadAudio.error.message) ||
    null;

  const reset = () => {
    setPatientId("");
    setEncounterId("");
    setDepartmentId("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!patientId || !encounterId || !departmentId || !file) return;
    const session = await createSession.mutateAsync({
      patient_id: patientId,
      encounter_id: encounterId,
      department_id: departmentId,
    });
    await uploadAudio.mutateAsync({ id: session.id, file });
    onCreated?.(session.id);
    reset();
    onClose();
  };

  return (
    <div className="janus-modal-backdrop" onClick={onClose}>
      <div
        className="janus-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="janus-modal-head">
          <Upload style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
          <h3>Upload audio</h3>
          <button
            type="button"
            className="janus-icon-btn"
            onClick={onClose}
            title="Close"
          >
            <X />
          </button>
        </div>
        <div className="janus-modal-body">
          <div>
            <label className="janus-label" htmlFor="upload-patient">
              Patient ID
            </label>
            <input
              id="upload-patient"
              className="janus-input"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            />
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-encounter">
              Encounter ID
            </label>
            <input
              id="upload-encounter"
              className="janus-input"
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
            />
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-department">
              Department ID
            </label>
            <input
              id="upload-department"
              className="janus-input"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            />
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-file">
              Audio file
            </label>
            <input
              id="upload-file"
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FORMATS}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="janus-file-input"
            />
            {file ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--janus-text-light)",
                }}
              >
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            ) : null}
          </div>
          {error ? <div className="janus-error-text">Upload failed: {error}</div> : null}
        </div>
        <div className="janus-modal-foot">
          <button
            type="button"
            className="janus-btn janus-btn-ghost janus-btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="janus-btn janus-btn-primary janus-btn-sm"
            onClick={handleSubmit}
            disabled={
              busy || !patientId || !encounterId || !departmentId || !file
            }
          >
            {busy ? "Uploading…" : "Upload & process"}
          </button>
        </div>
      </div>
    </div>
  );
}
