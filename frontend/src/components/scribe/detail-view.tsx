import { useState } from "react";
import {
  Ban,
  CheckCheck,
  Clock,
  FileText,
  Inbox,
  MessageSquare,
  RefreshCcw,
  Send,
  TriangleAlert,
  Trash2,
  UserRound,
  X,
  Check,
} from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type {
  Approvals,
  DiagnosisLab,
  FeedbackNote,
  SectionContent,
  SectionKey,
  StatusId,
} from "./types";
import { STATUS, isInPipeline, wordCount } from "./status";
import { StatusPill } from "./status-pill";
import { AudioStrip } from "./audio-strip";
import { PipelineProgress } from "./pipeline-progress";
import { SectionCard } from "./section-card";
import { LabsTable, PlanBody } from "./section-bodies";
import { TranscriptCard } from "./transcript-card";
import { UsageCostCard } from "./usage-cost-card";
import { fmtRelative } from "./format";

interface Props {
  session: ScribeSessionDetail | null;
  statusId: StatusId | null;
  approvals: Approvals;
  notes: FeedbackNote[];
  loading: boolean;
  canApprove: boolean;
  onApprove: (section: SectionKey) => void;
  onApproveAll: () => void;
  onReject: () => void;
  onDelete: () => void;
  onSend: () => void;
  onSaveSection: (section: SectionKey, content: SectionContent) => void;
  onOpenNotes: () => void;
  onAddNoteForSection: (section: SectionKey) => void;
  onRetry: () => void;
}

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

function notesForSection(notes: FeedbackNote[], section: SectionKey): number {
  return notes.filter((n) => n.section === section).length;
}

export function DetailView({
  session,
  statusId,
  approvals,
  notes,
  loading,
  canApprove,
  onApprove,
  onApproveAll,
  onReject,
  onDelete,
  onSend,
  onSaveSection,
  onOpenNotes,
  onAddNoteForSection,
  onRetry,
}: Props) {
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [draftContent, setDraftContent] = useState<SectionContent>("");

  const startEdit = (section: SectionKey) => {
    const current = session?.sections?.[section]?.content;
    setDraftContent(current ?? (section === "labs" ? [] : ""));
    setEditingSection(section);
  };

  const saveEdit = () => {
    if (!editingSection) return;
    onSaveSection(editingSection, draftContent);
    setEditingSection(null);
  };

  const cancelEdit = () => setEditingSection(null);
  if (loading || !session || !statusId) {
    return (
      <div className="janus-detail-pane">
        <div className="janus-detail-empty">
          <FileText />
          <div>{loading ? "Loading encounter…" : "Select an encounter to review."}</div>
        </div>
      </div>
    );
  }

  const status = STATUS[statusId];
  const isReady = statusId === "ready";
  const isSent = statusId === "sent";
  const isFailed = statusId === "failed";
  const isRejected = statusId === "rejected";
  const inPipeline = isInPipeline(statusId);

  const aiOutput = session.ai_output;
  const hasSections = !!aiOutput;
  const approvedCount = (Object.keys(approvals) as SectionKey[]).filter(
    (k) => approvals[k],
  ).length;
  const allApproved = approvedCount === 4;
  const totalNotes = notes.length;
  const words = wordCount(session.transcript);

  const copySection = (text: string | undefined) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="janus-detail-pane">
      <div className="janus-detail-header">
        <div className="janus-detail-title-row">
          <div className="janus-detail-title">
            <h2>{session.patient_id}</h2>
            <p className="janus-detail-sub">
              Encounter {session.encounter_id} · Dept {session.department_id}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusPill status={status} large />
            <button
              type="button"
              className="janus-btn janus-btn-danger-ghost janus-btn-sm"
              onClick={onDelete}
            >
              <Trash2 />
              Delete
            </button>
          </div>
        </div>
        <div className="janus-detail-meta-row">
          <span className="janus-meta-item">
            <UserRound />
            Provider not on file
          </span>
          <span className="janus-meta-item">
            <Clock />
            Created {fmtRelative(session.created_at)}
          </span>
          {words > 0 ? (
            <span className="janus-meta-item">
              <FileText />
              {words.toLocaleString()} words
            </span>
          ) : null}
          <span className="janus-meta-item">
            <Inbox />
            Status: {status.label.toLowerCase()}
          </span>
          {totalNotes > 0 ? (
            <span
              className="janus-meta-item"
              style={{ color: "var(--janus-warning-text)" }}
            >
              <MessageSquare />
              {totalNotes} feedback note{totalNotes === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {hasSections || session.audio_available ? (
          <AudioStrip sessionId={session.id} available={session.audio_available} />
        ) : null}
        {inPipeline ? <PipelineProgress status={status} /> : null}
      </div>

      <UsageCostCard usage={session.usage} status={session.status} inPipeline={inPipeline} />

      {isRejected ? (
        <div className="janus-failure-banner">
          <Ban />
          <div>
            <strong>Encounter rejected</strong>
            This encounter was rejected and will not be sent to the EHR.
          </div>
        </div>
      ) : null}

      {isFailed ? (
        <div className="janus-failure-banner">
          <TriangleAlert />
          <div>
            <strong>Transcription failed</strong>
            {session.error_message ?? "Pipeline could not complete."}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={onRetry}
              >
                <RefreshCcw />
                Retry pipeline
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {hasSections && !isRejected ? (
        <div className="janus-approval-bar">
          <div className="janus-approval-progress">
            <span>Sections approved</span>
            <div className="janus-approval-pips">
              {SECTION_KEYS.map((k) => (
                <div
                  key={k}
                  className={`janus-approval-pip ${approvals[k] ? "done" : ""}`}
                />
              ))}
            </div>
            <span>
              <strong>{approvedCount}</strong> of 4
            </span>
          </div>
          <div className="janus-action-cluster">
            <button
              type="button"
              className="janus-btn janus-btn-ghost janus-btn-sm"
              onClick={onOpenNotes}
            >
              <MessageSquare />
              Feedback{totalNotes > 0 ? ` (${totalNotes})` : ""}
            </button>
            {canApprove && !isSent && !allApproved ? (
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={onApproveAll}
              >
                <CheckCheck />
                Approve all
              </button>
            ) : null}
            {canApprove && !isSent ? (
              <button
                type="button"
                className="janus-btn janus-btn-danger-ghost janus-btn-sm"
                onClick={onReject}
              >
                <X />
                Reject
              </button>
            ) : null}
            {canApprove ? (
              <button
                type="button"
                className="janus-btn janus-btn-primary"
                disabled={!allApproved || isSent}
                onClick={!isSent && allApproved ? onSend : undefined}
                title={
                  isSent
                    ? "Already sent"
                    : allApproved
                      ? "Send to EHR"
                      : "Approve all sections first"
                }
              >
                {isSent ? <Check /> : <Send />}
                {isSent ? "Sent to EHR" : "Send to EHR"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="janus-detail-body">
        {hasSections && session.sections ? (
          <>
            {(["hpi", "plan", "exam", "labs"] as SectionKey[]).map((sk) => {
              const sec = session.sections[sk];
              const textContent = typeof sec.content === "string" ? sec.content : "";
              const labsContent = Array.isArray(sec.content) ? sec.content as DiagnosisLab[] : [];
              const isEditing = editingSection === sk;
              const stale = sec.state === "stale";
              return (
                <SectionCard
                  key={sk}
                  sectionKey={sk}
                  approved={approvals[sk]}
                  stale={stale}
                  noteCount={notesForSection(notes, sk)}
                  canApprove={canApprove}
                  canEdit={canApprove && isReady}
                  onApprove={() => onApprove(sk)}
                  onEdit={() => startEdit(sk)}
                  onAddNote={() => onAddNoteForSection(sk)}
                  onOpenNotes={onOpenNotes}
                  onCopy={() =>
                    sk === "labs"
                      ? copySection(labsContent.map((d) => `${d.diagnosis} — ${d.lab}`).join("\n"))
                      : copySection(textContent)
                  }
                >
                  {isEditing ? (
                    sk === "labs" ? (
                      <LabsEditor
                        rows={draftContent as DiagnosisLab[]}
                        onChange={(rows) => setDraftContent(rows)}
                        onSave={saveEdit}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <TextEditor
                        value={draftContent as string}
                        onChange={(v) => setDraftContent(v)}
                        onSave={saveEdit}
                        onCancel={cancelEdit}
                      />
                    )
                  ) : sk === "labs" ? (
                    labsContent.length ? (
                      <LabsTable rows={labsContent} />
                    ) : (
                      <p><em>No diagnoses or labs extracted.</em></p>
                    )
                  ) : sk === "plan" ? (
                    textContent ? (
                      <PlanBody body={textContent} />
                    ) : (
                      <p><em>No assessment & plan extracted.</em></p>
                    )
                  ) : (
                    <p>{textContent || <em>No content extracted.</em>}</p>
                  )}
                </SectionCard>
              );
            })}

            <TranscriptCard transcript={session.transcript} />
          </>
        ) : (
          <div
            style={{
              background: "var(--janus-white)",
              border: "2px solid var(--janus-border)",
              borderRadius: "var(--janus-radius-card)",
              padding: 40,
              textAlign: "center",
              color: "var(--janus-text-light)",
            }}
          >
            <Clock
              style={{
                width: 32,
                height: 32,
                color: "var(--janus-border)",
                display: "inline-block",
                marginBottom: 12,
              }}
            />
            <div style={{ fontSize: 14 }}>
              {isReady
                ? "AI output is being prepared."
                : "Structured output will appear here once the pipeline completes."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="janus-section-editor">
      <textarea
        className="janus-editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        autoFocus
      />
      <div className="janus-editor-actions">
        <button type="button" className="janus-btn janus-btn-primary janus-btn-sm" onClick={onSave}>
          Save
        </button>
        <button type="button" className="janus-btn janus-btn-ghost janus-btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function LabsEditor({
  rows,
  onChange,
  onSave,
  onCancel,
}: {
  rows: DiagnosisLab[];
  onChange: (rows: DiagnosisLab[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (i: number, field: keyof DiagnosisLab, value: string) => {
    const next = rows.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    onChange(next);
  };
  const addRow = () => onChange([...rows, { diagnosis: "", lab: "" }]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="janus-section-editor">
      <table className="janus-labs-table janus-labs-editor-table">
        <thead>
          <tr>
            <th>Diagnosis</th>
            <th>Lab / Test</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  className="janus-editor-input"
                  value={row.diagnosis}
                  onChange={(e) => update(i, "diagnosis", e.target.value)}
                  placeholder="Diagnosis (ICD code)"
                />
              </td>
              <td>
                <input
                  className="janus-editor-input"
                  value={row.lab}
                  onChange={(e) => update(i, "lab", e.target.value)}
                  placeholder="Lab or test"
                />
              </td>
              <td>
                <button
                  type="button"
                  className="janus-section-action"
                  title="Remove row"
                  onClick={() => removeRow(i)}
                >
                  <X />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="janus-editor-actions">
        <button type="button" className="janus-btn janus-btn-ghost janus-btn-sm" onClick={addRow}>
          + Add row
        </button>
        <button type="button" className="janus-btn janus-btn-primary janus-btn-sm" onClick={onSave}>
          Save
        </button>
        <button type="button" className="janus-btn janus-btn-ghost janus-btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

