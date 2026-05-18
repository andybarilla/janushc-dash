import { MessageSquare } from "lucide-react";
import type { Approvals, SectionKey } from "@/components/scribe/types";

const KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

interface Props {
  approvals: Approvals;
  noteCount: number;
  onOpenNotes: () => void;
}

export function MApprovalBar({ approvals, noteCount, onOpenNotes }: Props) {
  const approvedCount = KEYS.filter((k) => approvals[k]).length;

  return (
    <div className="m-approval-bar">
      <span>
        <strong>{approvedCount}</strong> of 4 approved
      </span>
      <div className="m-approval-pips">
        {KEYS.map((k) => (
          <div key={k} className={`m-approval-pip ${approvals[k] ? "done" : ""}`} />
        ))}
      </div>
      <button
        type="button"
        className="m-approval-feedback"
        onClick={onOpenNotes}
        aria-label="Open feedback"
      >
        <MessageSquare />
        {noteCount > 0 ? (
          <span className="count-dot">{noteCount}</span>
        ) : (
          <span>Feedback</span>
        )}
      </button>
    </div>
  );
}
