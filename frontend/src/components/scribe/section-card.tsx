import type { ReactNode } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  FileText,
  MessageSquare,
  MessageSquarePlus,
  Microscope,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { SectionKey } from "./types";

interface SectionMeta {
  key: SectionKey;
  title: string;
  icon: LucideIcon;
}

export const SECTIONS: Record<SectionKey, SectionMeta> = {
  hpi: { key: "hpi", title: "HPI", icon: FileText },
  plan: { key: "plan", title: "Assessment & Plan", icon: ClipboardList },
  exam: { key: "exam", title: "Physical Exam", icon: Stethoscope },
  labs: { key: "labs", title: "Diagnoses & Labs", icon: Microscope },
};

interface Props {
  sectionKey: SectionKey;
  approved: boolean;
  noteCount: number;
  onApprove: () => void;
  onAddNote: () => void;
  onOpenNotes: () => void;
  onCopy: () => void;
  children: ReactNode;
}

export function SectionCard({
  sectionKey,
  approved,
  noteCount,
  onApprove,
  onAddNote,
  onOpenNotes,
  onCopy,
  children,
}: Props) {
  const meta = SECTIONS[sectionKey];
  const Icon = meta.icon;
  return (
    <div
      className={`janus-section-card ${approved ? "approved" : ""} ${
        noteCount > 0 ? "has-notes" : ""
      }`}
    >
      <div className="janus-section-head">
        <div className="janus-section-icon">
          <Icon />
        </div>
        <div>
          <div className="janus-section-title">{meta.title}</div>
        </div>
        <div className="janus-section-actions">
          {noteCount > 0 ? (
            <button
              type="button"
              className="janus-section-action"
              title={`${noteCount} note${noteCount === 1 ? "" : "s"} on this section`}
              onClick={onOpenNotes}
            >
              <MessageSquare />
              <span className="janus-section-note-count">{noteCount}</span>
            </button>
          ) : (
            <button
              type="button"
              className="janus-section-action"
              title="Add feedback for this section"
              onClick={onAddNote}
            >
              <MessageSquarePlus />
            </button>
          )}
          <button
            type="button"
            className="janus-section-action"
            title="Copy to clipboard"
            onClick={onCopy}
          >
            <Copy />
          </button>
          <button
            type="button"
            className={`janus-approve-toggle ${approved ? "done" : ""}`}
            onClick={onApprove}
          >
            <span className="janus-check">
              <Check />
            </span>
            {approved ? "Approved" : "Approve"}
          </button>
        </div>
      </div>
      <div className="janus-section-body">{children}</div>
    </div>
  );
}
