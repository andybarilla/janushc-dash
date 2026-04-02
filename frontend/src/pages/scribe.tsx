import { useState } from "react";
import {
  useScribeSessions,
  useCreateScribeSession,
  useProcessScribeSession,
} from "@/lib/scribe-queries";
import { Button } from "@/components/ui/button";

export default function ScribePage() {
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");

  const { data: sessions = [], isLoading } = useScribeSessions();
  const createSession = useCreateScribeSession();
  const processSession = useProcessScribeSession();

  const handleCreate = async () => {
    const session = await createSession.mutateAsync({
      patient_id: patientId,
      encounter_id: encounterId,
      department_id: departmentId,
    });
    setActiveSessionId(session.id);
  };

  const handleProcess = async () => {
    if (!activeSessionId || !transcript) return;
    await processSession.mutateAsync({
      id: activeSessionId,
      transcript,
    });
    setTranscript("");
    setActiveSessionId("");
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

      {/* Create session + submit transcript */}
      <div className="space-y-3 bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {activeSessionId ? "Submit Transcript" : "New Session"}
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
              disabled={!patientId || !encounterId || !departmentId || createSession.isPending}
              size="sm"
            >
              {createSession.isPending ? "Creating..." : "Create Session"}
            </Button>
          </>
        ) : (
          <>
            <textarea
              placeholder="Paste transcript here..."
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={8}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleProcess}
                disabled={!transcript || processSession.isPending}
                size="sm"
              >
                {processSession.isPending ? "Processing..." : "Process Transcript"}
              </Button>
              <Button
                onClick={() => setActiveSessionId("")}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Session history */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Session History</h3>
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">No sessions yet.</div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="bg-card border border-border rounded-lg p-3 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="text-sm">
                    Patient {session.patient_id} — Encounter {session.encounter_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(session.created_at).toLocaleString()}
                  </div>
                </div>
                <span className={`text-xs font-medium ${statusColor[session.status] || ""}`}>
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
