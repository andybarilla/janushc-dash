import { AlertTriangle } from "lucide-react";
import type { RecordingDraftMetadata } from "@/lib/recording-drafts";

interface RecoveryBannerProps {
  draft: RecordingDraftMetadata;
  onRecover: () => void;
  onDiscard: () => void;
  error?: string | null;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatStart(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RecoveryBanner({ draft, onRecover, onDiscard, error }: RecoveryBannerProps) {
  const startedAt = formatStart(draft.startedAt);
  return (
    <div className="janus-card" role="status" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <AlertTriangle style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong>Unsaved recording</strong>
          <div className="janus-help-text">
            {formatDuration(draft.elapsedSeconds)}
            {startedAt ? ` · started ${startedAt}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="janus-btn janus-btn-primary janus-btn-sm" onClick={onRecover}>
            Recover recording
          </button>
          <button type="button" className="janus-btn janus-btn-ghost janus-btn-sm" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>
      {error ? <div className="janus-error-text">{error}</div> : null}
    </div>
  );
}
