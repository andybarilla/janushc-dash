import {
  CheckCheck,
  Clock,
  FileText,
  Inbox,
  MessageSquare,
  RefreshCcw,
  Send,
  TriangleAlert,
  UserRound,
  X,
  Check,
} from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type {
  Approvals,
  FeedbackNote,
  SectionKey,
  StatusId,
} from "./types";
import { STATUS, isInPipeline, wordCount } from "./status";
import { StatusPill } from "./status-pill";
import { AudioStrip } from "./audio-strip";
import { PipelineProgress } from "./pipeline-progress";
import { SectionCard } from "./section-card";
import { TranscriptCard } from "./transcript-card";
import { fmtRelative } from "./format";

interface Props {
  session: ScribeSessionDetail | null;
  statusId: StatusId | null;
  approvals: Approvals;
  notes: FeedbackNote[];
  loading: boolean;
  onApprove: (section: SectionKey) => void;
  onApproveAll: () => void;
  onReject: () => void;
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
  onApprove,
  onApproveAll,
  onReject,
  onOpenNotes,
  onAddNoteForSection,
  onRetry,
}: Props) {
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
          <StatusPill status={status} large />
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

        {hasSections ? <AudioStrip /> : null}
        {inPipeline ? <PipelineProgress status={status} /> : null}
      </div>

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

      {hasSections ? (
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
            {!isSent && !allApproved ? (
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={onApproveAll}
              >
                <CheckCheck />
                Approve all
              </button>
            ) : null}
            {!isSent ? (
              <button
                type="button"
                className="janus-btn janus-btn-danger-ghost janus-btn-sm"
                onClick={onReject}
              >
                <X />
                Reject
              </button>
            ) : null}
            <button
              type="button"
              className="janus-btn janus-btn-primary"
              disabled={!allApproved}
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
          </div>
        </div>
      ) : null}

      <div className="janus-detail-body">
        {hasSections && aiOutput ? (
          <>
            <SectionCard
              sectionKey="hpi"
              approved={approvals.hpi}
              noteCount={notesForSection(notes, "hpi")}
              onApprove={() => onApprove("hpi")}
              onAddNote={() => onAddNoteForSection("hpi")}
              onOpenNotes={onOpenNotes}
              onCopy={() => copySection(aiOutput.hpi)}
            >
              <p>{aiOutput.hpi || <em>No HPI extracted.</em>}</p>
            </SectionCard>

            <SectionCard
              sectionKey="plan"
              approved={approvals.plan}
              noteCount={notesForSection(notes, "plan")}
              onApprove={() => onApprove("plan")}
              onAddNote={() => onAddNoteForSection("plan")}
              onOpenNotes={onOpenNotes}
              onCopy={() => copySection(aiOutput.assessment_plan)}
            >
              {aiOutput.assessment_plan ? (
                <PlanBody body={aiOutput.assessment_plan} />
              ) : (
                <p>
                  <em>No assessment & plan extracted.</em>
                </p>
              )}
            </SectionCard>

            <SectionCard
              sectionKey="exam"
              approved={approvals.exam}
              noteCount={notesForSection(notes, "exam")}
              onApprove={() => onApprove("exam")}
              onAddNote={() => onAddNoteForSection("exam")}
              onOpenNotes={onOpenNotes}
              onCopy={() => copySection(aiOutput.physical_exam)}
            >
              <div className="janus-exam-block">
                {aiOutput.physical_exam || (
                  <em>No physical exam findings extracted.</em>
                )}
              </div>
            </SectionCard>

            <SectionCard
              sectionKey="labs"
              approved={approvals.labs}
              noteCount={notesForSection(notes, "labs")}
              onApprove={() => onApprove("labs")}
              onAddNote={() => onAddNoteForSection("labs")}
              onOpenNotes={onOpenNotes}
              onCopy={() =>
                copySection(
                  aiOutput.diagnoses_labs
                    ?.map((d) => `${d.diagnosis} — ${d.lab}`)
                    .join("\n"),
                )
              }
            >
              {aiOutput.diagnoses_labs?.length ? (
                <LabsTable rows={aiOutput.diagnoses_labs} />
              ) : (
                <p>
                  <em>No diagnoses or labs extracted.</em>
                </p>
              )}
            </SectionCard>

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

function PlanBody({ body }: { body: string }) {
  // The AI output stores the plan as free text. If it looks like a numbered or
  // bulleted list, render it as one; otherwise fall back to a paragraph.
  const lines = body
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return <p>{body}</p>;
  }
  return (
    <ol className="janus-plan-list">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ol>
  );
}

function LabsTable({
  rows,
}: {
  rows: { diagnosis: string; lab: string }[];
}) {
  return (
    <table className="janus-labs-table">
      <tbody>
        {rows.map((row, i) => {
          const m = row.diagnosis.match(/^(.+?)\s*\(([A-Z0-9.]+)\)\s*$/);
          const name = m ? m[1] : row.diagnosis;
          const code = m ? m[2] : null;
          return (
            <tr key={i}>
              <td>
                {name}
                {code ? <span className="janus-dx-code">{code}</span> : null}
              </td>
              <td>{row.lab}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
