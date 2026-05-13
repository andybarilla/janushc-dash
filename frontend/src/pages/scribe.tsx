import { useRef, useState } from "react";
import {
  useScribeSessions,
  useCreateScribeSession,
  useUploadScribeAudio,
  useScribeSession,
} from "@/lib/scribe-queries";
import { Button } from "@/components/ui/button";

const ACCEPTED_FORMATS = ".mp3,.m4a,.wav,.webm,.ogg";

export default function ScribePage() {
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: sessions = [], isLoading } = useScribeSessions();
  const { data: selectedSession, isLoading: isLoadingSelectedSession } =
    useScribeSession(selectedHistorySessionId);
  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();

  const handleCreate = async () => {
    const session = await createSession.mutateAsync({
      patient_id: patientId,
      encounter_id: encounterId,
      department_id: departmentId,
    });
    setActiveSessionId(session.id);
  };

  const handleUpload = async () => {
    if (!activeSessionId || !selectedFile) return;
    await uploadAudio.mutateAsync({
      id: activeSessionId,
      file: selectedFile,
    });
    setSelectedFile(null);
    setActiveSessionId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const statusColor: Record<string, string> = {
    processing: "text-yellow-500",
    complete: "text-green-500",
    error: "text-red-500",
    recording: "text-blue-500",
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold">Scribe</h2>

      <div className="space-y-3 bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {activeSessionId ? "Upload Audio" : "New Session"}
        </h3>

        {!activeSessionId ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Patient ID"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Encounter ID"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Department ID"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={
                !patientId ||
                !encounterId ||
                !departmentId ||
                createSession.isPending
              }
              size="sm"
            >
              {createSession.isPending ? "Creating..." : "Create Session"}
            </Button>
          </>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FORMATS}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-border file:text-sm file:font-medium file:bg-background file:text-foreground hover:file:bg-muted"
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
            {uploadAudio.isError && (
              <p className="text-xs text-red-500">
                Upload failed: {uploadAudio.error instanceof Error ? uploadAudio.error.message : "Unknown error"}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploadAudio.isPending}
                size="sm"
              >
                {uploadAudio.isPending
                  ? "Transcribing & Processing..."
                  : "Upload & Process"}
              </Button>
              <Button
                onClick={() => {
                  setActiveSessionId("");
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Session History
        </h3>
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">
            Loading...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No sessions yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedHistorySessionId(session.id)}
                className={`w-full text-left bg-card border rounded-lg p-3 flex items-center justify-between hover:bg-muted/50 ${
                  selectedHistorySessionId === session.id
                    ? "border-primary"
                    : "border-border"
                }`}
              >
                <div className="space-y-1">
                  <div className="text-sm">
                    Patient {session.patient_id} — Encounter{" "}
                    {session.encounter_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(session.created_at).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`text-xs font-medium ${statusColor[session.status] || ""}`}
                >
                  {session.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedHistorySessionId && (
        <div className="space-y-4 bg-card border border-border rounded-lg p-4">
          {isLoadingSelectedSession ? (
            <div className="text-sm text-muted-foreground">Loading session...</div>
          ) : selectedSession ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    Patient {selectedSession.patient_id}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Encounter {selectedSession.encounter_id} · Department {selectedSession.department_id}
                  </p>
                </div>
                <span className={`text-xs font-medium ${statusColor[selectedSession.status] || ""}`}>
                  {selectedSession.status}
                </span>
              </div>

              {selectedSession.error_message && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                  {selectedSession.error_message}
                </div>
              )}

              {selectedSession.ai_output ? (
                <div className="space-y-4 text-sm">
                  <ResultSection title="HPI" body={selectedSession.ai_output.hpi} />
                  <ResultSection title="Assessment & Plan" body={selectedSession.ai_output.assessment_plan} />
                  <ResultSection title="Physical Exam" body={selectedSession.ai_output.physical_exam} />
                  {selectedSession.ai_output.diagnoses_labs?.length > 0 && (
                    <section className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Diagnoses / Labs
                      </h4>
                      <ul className="list-disc space-y-1 pl-5">
                        {selectedSession.ai_output.diagnoses_labs.map((item, index) => (
                          <li key={index}>
                            {item.diagnosis} — {item.lab}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No AI note output stored for this session yet.
                </p>
              )}

              {selectedSession.transcript && (
                <details className="space-y-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    Transcript
                  </summary>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">
                    {selectedSession.transcript}
                  </pre>
                </details>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ResultSection({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <p className="whitespace-pre-wrap leading-relaxed">{body}</p>
    </section>
  );
}
