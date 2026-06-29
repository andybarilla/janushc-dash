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
  return (
    <LocalRecordingsInbox
      drafts={[draft]}
      onRecover={() => onRecover()}
      onDiscard={() => onDiscard()}
      error={error}
    />
  );
}

interface LocalRecordingsInboxProps {
  drafts: RecordingDraftMetadata[];
  onRecover: (draft: RecordingDraftMetadata) => void;
  onDiscard: (draft: RecordingDraftMetadata) => void;
  error?: string | null;
}

export function LocalRecordingsInbox({
  drafts,
  onRecover,
  onDiscard,
  error,
}: LocalRecordingsInboxProps) {
  if (drafts.length === 0) return null;

  return (
    <div className="janus-card" role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AlertTriangle style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
        <div>
          <strong>Local recording inbox</strong>
          <div className="janus-help-text">
            {drafts.length === 1
              ? "1 recording is saved on this device until uploaded."
              : `${drafts.length} recordings are saved on this device until uploaded.`}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {drafts.map((draft) => (
          <LocalRecordingRow
            key={draft.draftId}
            draft={draft}
            onRecover={() => onRecover(draft)}
            onDiscard={() => onDiscard(draft)}
          />
        ))}
      </div>
      {error ? <div className="janus-error-text">{error}</div> : null}
    </div>
  );
}

function LocalRecordingRow({
  draft,
  onRecover,
  onDiscard,
}: {
  draft: RecordingDraftMetadata;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  const startedAt = formatStart(draft.startedAt);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>{draft.patientName || draft.patientId || "Unsaved recording"}</strong>
        <div className="janus-help-text">
          {formatDuration(draft.elapsedSeconds)}
          {startedAt ? ` · started ${startedAt}` : ""}
          {draft.appointmentTime ? ` · ${draft.appointmentTime}` : ""}
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
  );
}
