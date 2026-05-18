import { Clock, FileText } from "lucide-react";
import type { ScribeSession } from "@/lib/scribe-queries";
import { STATUS } from "@/components/scribe/status";
import { fmtRelative } from "@/components/scribe/format";
import type { StatusId } from "@/components/scribe/types";
import { MStatusPill } from "./status-pill";

interface Props {
  session: ScribeSession;
  statusId: StatusId;
  wordCount: number;
  selected: boolean;
  onClick: () => void;
}

export function MSessionRow({ session, statusId, wordCount, selected, onClick }: Props) {
  return (
    <button
      type="button"
      className={`m-row ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="m-row-top">
        <div className="m-row-patient">{session.patient_id}</div>
        <MStatusPill status={STATUS[statusId]} />
      </div>
      <div className="m-row-enc">
        Encounter {session.encounter_id}
        {session.department_id ? ` · Dept ${session.department_id}` : ""}
      </div>
      <div className="m-row-meta">
        <span>
          <Clock />
          {new Date(session.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        {wordCount > 0 ? (
          <span>
            <FileText />
            {wordCount.toLocaleString()} w
          </span>
        ) : null}
        <span style={{ marginLeft: "auto" }}>{fmtRelative(session.created_at)}</span>
      </div>
    </button>
  );
}
