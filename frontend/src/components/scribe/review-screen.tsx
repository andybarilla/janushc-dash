import { useState } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  Clock,
  FileText,
  MessageSquare,
  RefreshCcw,
  Send,
  TriangleAlert,
  X,
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
import { STATUS, isInPipeline, isReadyToSend, wordCount } from "./status";
import { PipelineProgress } from "./pipeline-progress";
import { SectionCard } from "./section-card";
import { LabsTable, PlanBody } from "./section-bodies";
import { TranscriptCard } from "./transcript-card";
import { TextEditor, LabsEditor } from "./section-editors";
import { ReviewTopBar } from "./review-top-bar";
import { ReviewMetaBar } from "./review-meta-bar";

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

interface Props {
  session: ScribeSessionDetail | null;
  statusId: StatusId | null;
  approvals: Approvals;
  notes: FeedbackNote[];
  loading: boolean;
  notFound: boolean;
  canApprove: boolean;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
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

function notesForSection(notes: FeedbackNote[], section: SectionKey): number {
  return notes.filter((n) => n.section === section).length;
}

export function ReviewScreen({
  session,
  statusId,
  approvals,
  notes,
  loading,
  notFound,
  canApprove,
  onBack,
  onPrev,
  onNext,
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

  if (loading) {
    return (
      <div className="janus-review-screen">
        <div className="janus-detail-empty">
          <FileText />
          <div>Loading encounter…</div>
        </div>
      </div>
    );
  }

  if (notFound || !session || !statusId) {
    return (
      <div className="janus-review-screen">
        <div className="janus-detail-empty">
          <FileText />
          <div>This encounter could not be found.</div>
          <button
            type="button"
            className="janus-btn janus-btn-secondary janus-btn-sm"
            onClick={onBack}
          >
            Back to inbox
          </button>
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

  const hasSections = !!session.ai_output;
  const approvedCount = (Object.keys(approvals) as SectionKey[]).filter(
    (k) => approvals[k],
  ).length;
  const allApproved = approvedCount === 4;
  const readyToSend = isReadyToSend(approvals);
  const totalNotes = notes.length;
  const words = wordCount(session.transcript);

  const copySection = (text: string | undefined) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="janus-review-screen">
      <ReviewTopBar
        session={session}
        status={status}
        onBack={onBack}
        onPrev={onPrev}
        onNext={onNext}
        onDelete={onDelete}
      />
      <ReviewMetaBar
        session={session}
        status={status}
        statusId={statusId}
        inPipeline={inPipeline}
        words={words}
        totalNotes={totalNotes}
        hasSections={hasSections}
      />
      {inPipeline ? <PipelineProgress status={status} /> : null}

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
                disabled={!readyToSend || isSent}
                onClick={!isSent && readyToSend ? onSend : undefined}
                title={
                  isSent
                    ? "Already sent"
                    : readyToSend
                      ? "Send to EHR"
                      : "Approve HPI, Assessment & Plan, and Physical Exam first"
                }
              >
                {isSent ? <Check /> : <Send />}
                {isSent ? "Sent to EHR" : "Send to EHR"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="janus-review-body">
        {hasSections && session.sections ? (
          <>
            {SECTION_KEYS.map((sk) => {
              const sec = session.sections[sk];
              const textContent =
                typeof sec.content === "string" ? sec.content : "";
              const labsContent = Array.isArray(sec.content)
                ? (sec.content as DiagnosisLab[])
                : [];
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
                      ? copySection(
                          labsContent
                            .map((d) => `${d.diagnosis} — ${d.lab}`)
                            .join("\n"),
                        )
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
                      <p>
                        <em>No diagnoses or labs extracted.</em>
                      </p>
                    )
                  ) : sk === "plan" ? (
                    textContent ? (
                      <PlanBody body={textContent} />
                    ) : (
                      <p>
                        <em>No assessment &amp; plan extracted.</em>
                      </p>
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
