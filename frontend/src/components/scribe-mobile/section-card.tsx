import type { ReactNode } from "react";
import {
  CircleCheck,
  Circle,
  ClipboardList,
  FileText,
  MessageSquare,
  Microscope,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { SectionKey } from "@/components/scribe/types";

interface SectionMeta {
  title: string;
  icon: LucideIcon;
}

const SECTIONS: Record<SectionKey, SectionMeta> = {
  hpi: { title: "HPI", icon: FileText },
  plan: { title: "Assessment & Plan", icon: ClipboardList },
  exam: { title: "Physical Exam", icon: Stethoscope },
  labs: { title: "Diagnoses & Labs", icon: Microscope },
};

interface Props {
  sectionKey: SectionKey;
  approved: boolean;
  noteCount: number;
  canApprove: boolean;
  onApprove: () => void;
  onAddNote: () => void;
  children: ReactNode;
}

export function MSectionCard({
  sectionKey,
  approved,
  noteCount,
  canApprove,
  onApprove,
  onAddNote,
  children,
}: Props) {
  const meta = SECTIONS[sectionKey];
  const Icon = meta.icon;

  return (
    <div
      className={`m-section ${approved ? "approved" : ""} ${noteCount > 0 ? "has-notes" : ""}`}
    >
      <div className="m-section-head">
        <div className="m-section-icon">
          <Icon />
        </div>
        <div className="m-section-title">{meta.title}</div>
        <div className="m-section-head-actions">
          <button
            type="button"
            className="m-section-action"
            onClick={onAddNote}
            aria-label="Add feedback"
          >
            <MessageSquare />
            {noteCount > 0 ? <span className="note-pip">{noteCount}</span> : null}
          </button>
        </div>
      </div>
      <div className="m-section-body">{children}</div>
      <div className="m-approve-bar">
        <button
          type="button"
          className={`m-approve-btn ${approved ? "done" : ""}`}
          onClick={onApprove}
          disabled={!canApprove}
          aria-pressed={approved}
        >
          {approved ? <CircleCheck /> : <Circle />}
          {approved ? "Approved" : "Approve section"}
        </button>
      </div>
    </div>
  );
}
