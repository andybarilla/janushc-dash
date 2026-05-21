import { useMemo } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Inbox,
  Loader,
  Mic,
  Sparkles,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import type { ScribeSession } from "@/lib/scribe-queries";
import { deriveStatusId, isInPipeline } from "@/components/scribe/status";
import { fmtRelative } from "@/components/scribe/format";
import type { StatusId } from "@/components/scribe/types";
import type { MobileFilter } from "./filter-row";

interface Props {
  sessions: ScribeSession[];
  providerName: string;
  onRecord: () => void;
  onPaste: () => void;
  onOpenInbox: (filter: MobileFilter) => void;
  onOpenEncounter: (id: string) => void;
}

interface Entry {
  session: ScribeSession;
  statusId: StatusId;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function recentSub(entry: Entry): string {
  const { session, statusId } = entry;
  if (statusId === "sent")
    return `Sent to EHR · ${fmtRelative(session.sent_to_ehr_at ?? session.created_at)}`;
  if (statusId === "ready")
    return `Ready for review · ${fmtRelative(session.created_at)}`;
  if (statusId === "failed") return "Failed · needs attention";
  if (statusId === "rejected")
    return `Rejected · ${fmtRelative(session.rejected_at ?? session.created_at)}`;
  if (statusId === "transcribing") return `Transcribing · ${fmtRelative(session.created_at)}`;
  if (statusId === "extracting") return `Extracting · ${fmtRelative(session.created_at)}`;
  return `Queued · ${fmtRelative(session.created_at)}`;
}

function recentIcon(statusId: StatusId) {
  if (statusId === "sent") return { Icon: Check, cls: "success" };
  if (statusId === "ready") return { Icon: CircleDot, cls: "attention" };
  if (statusId === "failed" || statusId === "rejected")
    return { Icon: TriangleAlert, cls: "error" };
  if (statusId === "transcribing") return { Icon: Mic, cls: "progress" };
  if (statusId === "extracting") return { Icon: Sparkles, cls: "progress" };
  return { Icon: Loader, cls: "progress" };
}

export function MHomeView({
  sessions,
  providerName,
  onRecord,
  onPaste,
  onOpenInbox,
  onOpenEncounter,
}: Props) {
  const entries: Entry[] = useMemo(
    () => sessions.map((s) => ({ session: s, statusId: deriveStatusId(s) })),
    [sessions],
  );

  const counts = useMemo(
    () => ({
      ready: entries.filter((e) => e.statusId === "ready").length,
      pipeline: entries.filter((e) => isInPipeline(e.statusId)).length,
      sent: entries.filter((e) => e.statusId === "sent").length,
      attn: entries.filter(
        (e) => e.statusId === "failed" || e.statusId === "rejected",
      ).length,
      all: entries.filter((e) => e.statusId !== "rejected").length,
    }),
    [entries],
  );

  const recent = useMemo(() => {
    return [...entries]
      .sort(
        (a, b) =>
          new Date(b.session.created_at).getTime() -
          new Date(a.session.created_at).getTime(),
      )
      .slice(0, 4);
  }, [entries]);

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div className="m-topbar">
        <div className="m-brand">
          <div className="m-brand-mark">J</div>
          <div className="m-brand-text">
            <span className="brand">Janus</span>
            <span className="module">Scribe</span>
          </div>
        </div>
        <div className="m-topbar-actions">
          <button type="button" className="m-icon-btn" aria-label="Notifications">
            <Bell />
            {counts.attn > 0 ? <span className="badge-dot" /> : null}
          </button>
          <button type="button" className="m-icon-btn" aria-label="Profile">
            <UserRound />
          </button>
        </div>
      </div>

      <div className="m-body">
        <div className="m-home-greet">
          <span className="greet-lbl">{greeting()},</span>
          <span className="greet-name">{providerName}</span>
          <span className="greet-date">{dateStr}</span>
        </div>

        <button type="button" className="m-home-cta" onClick={onRecord}>
          <div className="cta-row">
            <div className="cta-mic">
              <Mic />
            </div>
            <div className="cta-text">
              <span className="cta-title">Record a session</span>
              <span className="cta-sub">Saved on device, uploaded when synced</span>
            </div>
            <ChevronRight className="cta-arrow" />
          </div>
        </button>

        <button type="button" className="m-home-cta" onClick={onPaste}>
          <div className="cta-row">
            <div className="cta-mic">
              <ClipboardList />
            </div>
            <div className="cta-text">
              <span className="cta-title">Paste a transcript</span>
              <span className="cta-sub">Process an existing text transcript</span>
            </div>
            <ChevronRight className="cta-arrow" />
          </div>
        </button>

        {counts.ready > 0 ? (
          <button
            type="button"
            className="m-shortcut-card"
            onClick={() => onOpenInbox("ready")}
          >
            <span className="shortcut-num">{counts.ready}</span>
            <div className="shortcut-body">
              <span className="shortcut-title">Sessions ready for your review</span>
              <span className="shortcut-sub">Approve sections and send to EHR</span>
            </div>
            <ChevronRight className="shortcut-arrow" />
          </button>
        ) : (
          <div className="m-shortcut-card empty">
            <span className="shortcut-num">0</span>
            <div className="shortcut-body">
              <span className="shortcut-title">You're all caught up</span>
              <span className="shortcut-sub">No sessions awaiting review</span>
            </div>
          </div>
        )}

        {counts.attn > 0 ? (
          <button
            type="button"
            className="m-shortcut-card alert"
            onClick={() => onOpenInbox("attention")}
          >
            <span className="shortcut-num">{counts.attn}</span>
            <div className="shortcut-body">
              <span className="shortcut-title">
                {counts.attn === 1 ? "Session needs attention" : "Sessions need attention"}
              </span>
              <span className="shortcut-sub">Failed transcription or EHR sync</span>
            </div>
            <ChevronRight className="shortcut-arrow" />
          </button>
        ) : null}

        <div className="m-section-lbl">Today</div>
        <div className="m-tiles">
          <button
            type="button"
            className="m-tile progress"
            onClick={() => onOpenInbox("in_pipeline")}
          >
            <div className="tile-icon">
              <Loader />
            </div>
            <span className="tile-num">{counts.pipeline}</span>
            <span className="tile-lbl">In pipeline</span>
          </button>
          <button
            type="button"
            className="m-tile"
            onClick={() => onOpenInbox("sent")}
          >
            <div className="tile-icon">
              <CheckCheck />
            </div>
            <span className="tile-num">{counts.sent}</span>
            <span className="tile-lbl">Sent to EHR</span>
          </button>
        </div>

        <div className="m-section-lbl">Recent</div>
        {recent.length === 0 ? (
          <div className="m-empty" style={{ padding: "32px 24px" }}>
            <Inbox />
            <div>No encounters yet today.</div>
          </div>
        ) : (
          <div className="m-recent-list">
            {recent.map((entry) => {
              const { Icon, cls } = recentIcon(entry.statusId);
              return (
                <button
                  key={entry.session.id}
                  type="button"
                  className="m-recent-row"
                  onClick={() => onOpenEncounter(entry.session.id)}
                >
                  <div className={`m-recent-icon ${cls}`}>
                    <Icon />
                  </div>
                  <div className="m-recent-body">
                    <div className="m-recent-name">{entry.session.patient_id}</div>
                    <div className="m-recent-sub">{recentSub(entry)}</div>
                  </div>
                  <ChevronRight className="m-recent-chev" />
                </button>
              );
            })}
          </div>
        )}

        <div style={{ height: 24 }} />

        <button
          type="button"
          className="m-home-inbox-link"
          onClick={() => onOpenInbox("all")}
        >
          View full inbox ({counts.all}) →
        </button>
      </div>
    </>
  );
}

