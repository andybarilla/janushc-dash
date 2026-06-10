import { useState } from "react";
import {
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Inbox,
  MessageSquare,
  Play,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  ScribeSessionDetail,
  ScribeUsageSummary,
} from "@/lib/scribe-queries";
import type { StatusDef, StatusId } from "./types";
import { AudioStrip } from "./audio-strip";
import { UsageCostCard } from "./usage-cost-card";
import { fmtRelative } from "./format";

interface Props {
  session: ScribeSessionDetail;
  status: StatusDef;
  statusId: StatusId;
  inPipeline: boolean;
  words: number;
  totalNotes: number;
  hasSections: boolean;
}

type Panel = "audio" | "cost" | null;

async function openDocument(sessionId: string) {
  const blob = await api.fetchBlob(`/api/scribe/sessions/${sessionId}/document`);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
}

function shortCost(usage?: ScribeUsageSummary): string | null {
  if (!usage) return null;
  const micros = usage.total_actual_cost_micros ?? usage.total_estimated_cost_micros;
  if (typeof micros !== "number") return null;
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function ReviewMetaBar({
  session,
  status,
  statusId,
  inPipeline,
  words,
  totalNotes,
  hasSections,
}: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [documentOpening, setDocumentOpening] = useState(false);
  const audioAvailable = hasSections || session.audio_available;
  const documentAvailable = !!session.document_filename;
  const cost = shortCost(session.usage);

  const toggle = (next: Panel) =>
    setPanel((current) => (current === next ? null : next));

  return (
    <div className="janus-review-meta">
      <div className="janus-review-meta-row">
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
        <div className="janus-review-pills">
          {audioAvailable ? (
            <button
              type="button"
              className={`janus-meta-pill ${panel === "audio" ? "active" : ""}`}
              onClick={() => toggle("audio")}
            >
              <Play />
              Audio
            </button>
          ) : null}
          {documentAvailable ? (
            <button
              type="button"
              className="janus-meta-pill"
              disabled={documentOpening}
              onClick={async () => {
                setDocumentOpening(true);
                try {
                  await openDocument(session.id);
                } finally {
                  setDocumentOpening(false);
                }
              }}
            >
              <ExternalLink />
              {documentOpening ? "Opening…" : "View original document"}
            </button>
          ) : null}
          <button
            type="button"
            className={`janus-meta-pill ${panel === "cost" ? "active" : ""}`}
            onClick={() => toggle("cost")}
          >
            <DollarSign />
            Usage &amp; Cost{cost ? ` · ${cost}` : ""}
          </button>
        </div>
      </div>
      {panel === "audio" && audioAvailable ? (
        <AudioStrip sessionId={session.id} available={session.audio_available} />
      ) : null}
      {panel === "cost" ? (
        <UsageCostCard
          usage={session.usage}
          statusId={statusId}
          inPipeline={inPipeline}
        />
      ) : null}
    </div>
  );
}
