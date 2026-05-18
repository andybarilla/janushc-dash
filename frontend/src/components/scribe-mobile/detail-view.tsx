import { Clock } from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type {
  Approvals,
  DiagnosisLab,
  FeedbackNote,
  SectionKey,
  StatusId,
} from "@/components/scribe/types";
import { isInPipeline } from "@/components/scribe/status";
import {
  ExamBody,
  HpiBody,
  LabsTable,
  PlanBody,
} from "@/components/scribe/section-bodies";
import { MDetailTopBar } from "./top-bar";
import { MEncounterHeader } from "./encounter-header";
import { MAudioStrip } from "./audio-strip";
import { MPipelineTracker } from "./pipeline-tracker";
import { MFailedBanner, MRejectedBanner } from "./banners";
import { MApprovalBar } from "./approval-bar";
import { MSectionCard } from "./section-card";
import { MTranscriptCard } from "./transcript-card";
import { MSendBar, type SendState } from "./send-bar";

interface Props {
  session: ScribeSessionDetail | null;
  statusId: StatusId | null;
  approvals: Approvals;
  notes: FeedbackNote[];
  loading: boolean;
  canApprove: boolean;
  onBack: () => void;
  onDelete: () => void;
  onApprove: (section: SectionKey) => void;
  onApproveAll: () => void;
  onSend: () => void;
  onOpenNotes: () => void;
  onAddNoteForSection: (section: SectionKey) => void;
  onRetry: () => void;
}

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

function notesForSection(notes: FeedbackNote[], section: SectionKey): number {
  return notes.filter((n) => n.section === section).length;
}

export function MDetailView({
  session,
  statusId,
  approvals,
  notes,
  loading,
  canApprove,
  onBack,
  onDelete,
  onApprove,
  onApproveAll,
  onSend,
  onOpenNotes,
  onAddNoteForSection,
  onRetry,
}: Props) {
  if (loading || !session || !statusId) {
    return (
      <>
        <MDetailTopBar title={session?.patient_id ?? "Encounter"} onBack={onBack} />
        <div className="m-body">
          <div className="m-empty" style={{ paddingTop: 80 }}>
            <Clock />
            <div>{loading ? "Loading encounter…" : "Encounter unavailable."}</div>
          </div>
        </div>
      </>
    );
  }

  const isSent = statusId === "sent";
  const isFailed = statusId === "failed";
  const isRejected = statusId === "rejected";
  const inPipeline = isInPipeline(statusId);
  const hasSections = !!session.ai_output;
  const sections = session.sections;
  const approvedCount = SECTION_KEYS.filter((k) => approvals[k]).length;
  const allApproved = approvedCount === 4;
  const totalNotes = notes.length;

  const sendState: SendState = isSent
    ? "sent"
    : allApproved && hasSections && !isRejected
      ? "ready"
      : "disabled";
  const showApproveAll =
    canApprove && hasSections && !isSent && !isRejected && !allApproved;

  return (
    <>
      <MDetailTopBar title={session.patient_id} onBack={onBack} onDelete={onDelete} />
      <div className="m-body">
        <MEncounterHeader session={session} statusId={statusId} />

        {hasSections || session.audio_available ? (
          <MAudioStrip sessionId={session.id} available={session.audio_available} />
        ) : null}
        {inPipeline ? <MPipelineTracker statusId={statusId} /> : null}

        {isRejected ? <MRejectedBanner /> : null}
        {isFailed ? (
          <MFailedBanner
            message={session.error_message ?? "Pipeline could not complete."}
            onRetry={onRetry}
          />
        ) : null}

        {hasSections && !isRejected ? (
          <MApprovalBar
            approvals={approvals}
            noteCount={totalNotes}
            onOpenNotes={onOpenNotes}
          />
        ) : null}

        {hasSections && sections ? (
          <div className="m-sections">
            {SECTION_KEYS.map((sk) => {
              const sec = sections[sk];
              const textContent =
                typeof sec.content === "string" ? sec.content : "";
              const labsContent = Array.isArray(sec.content)
                ? (sec.content as DiagnosisLab[])
                : [];
              return (
                <MSectionCard
                  key={sk}
                  sectionKey={sk}
                  approved={approvals[sk]}
                  noteCount={notesForSection(notes, sk)}
                  canApprove={canApprove && !isRejected}
                  onApprove={() => onApprove(sk)}
                  onAddNote={() => onAddNoteForSection(sk)}
                >
                  {sk === "labs" ? (
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
                        <em>No assessment & plan extracted.</em>
                      </p>
                    )
                  ) : sk === "exam" ? (
                    <ExamBody body={textContent} />
                  ) : (
                    <HpiBody body={textContent} />
                  )}
                </MSectionCard>
              );
            })}
            <MTranscriptCard transcript={session.transcript} />
          </div>
        ) : (
          <div className="m-empty" style={{ paddingTop: 60 }}>
            <Clock />
            <div>
              {statusId === "ready"
                ? "AI output is being prepared."
                : "Structured output appears here once the pipeline completes."}
            </div>
          </div>
        )}
      </div>

      {hasSections && !isRejected && canApprove ? (
        <MSendBar
          state={sendState}
          showApproveAll={showApproveAll}
          onApproveAll={onApproveAll}
          onSend={onSend}
        />
      ) : null}
    </>
  );
}
