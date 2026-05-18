import { Building2, Clock, FileText, UserRound } from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import { STATUS, wordCount } from "@/components/scribe/status";
import type { StatusId } from "@/components/scribe/types";
import { MStatusPill } from "./status-pill";

interface Props {
  session: ScribeSessionDetail;
  statusId: StatusId;
}

function fmtDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MEncounterHeader({ session, statusId }: Props) {
  const words = wordCount(session.transcript);
  const status = STATUS[statusId];

  return (
    <div className="m-detail-head">
      <div className="m-detail-titlerow">
        <div>
          <h2 className="m-patient-name">{session.patient_id}</h2>
          <p className="m-patient-sub">Encounter {session.encounter_id}</p>
        </div>
        <MStatusPill status={status} large />
      </div>
      <div className="m-detail-meta">
        <span>
          <UserRound />
          Provider not on file
        </span>
        {session.department_id ? (
          <span>
            <Building2 />
            Dept {session.department_id}
          </span>
        ) : null}
        <span>
          <Clock />
          {fmtDuration(undefined)}
        </span>
        {words > 0 ? (
          <span>
            <FileText />
            {words.toLocaleString()} w
          </span>
        ) : null}
      </div>
    </div>
  );
}
