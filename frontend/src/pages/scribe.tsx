import { useRef, useState } from "react";
import {
  useScribeSessions,
  useCreateScribeSession,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";
import { Button } from "@/components/ui/button";

const ACCEPTED_FORMATS = ".mp3,.m4a,.wav,.webm,.ogg";

export default function ScribePage() {
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: sessions = [], isLoading } = useScribeSessions();
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
              <div
                key={session.id}
                className="bg-card border border-border rounded-lg p-3 flex items-center justify-between"
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
