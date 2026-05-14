import {
  ChevronDown,
  CircleDot,
  Clock,
  FileText,
  Loader,
  Search,
  TriangleAlert,
  Check,
  type LucideIcon,
} from "lucide-react";
import type { ScribeSession } from "@/lib/scribe-queries";
import { fmtRelative } from "./format";
import { StatusPill } from "./status-pill";
import { STATUS, deriveStatusId, isInPipeline, wordCount } from "./status";
import type { StatusId } from "./types";

export type ListFilter = "all" | "ready" | "in_pipeline" | "sent" | "attention";

export interface SessionListEntry {
  session: ScribeSession;
  statusId: StatusId;
  wordCount: number;
}

interface Props {
  entries: SessionListEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  dateRange: string;
  onDateRange: (range: string) => void;
}

const FILTERS: {
  id: ListFilter;
  label: string;
  icon?: LucideIcon;
}[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready", icon: CircleDot },
  { id: "in_pipeline", label: "In pipeline", icon: Loader },
  { id: "sent", label: "Sent", icon: Check },
  { id: "attention", label: "Needs attn", icon: TriangleAlert },
];

function matchesFilter(statusId: StatusId, filter: ListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "ready") return statusId === "ready";
  if (filter === "in_pipeline") return isInPipeline(statusId);
  if (filter === "sent") return statusId === "sent";
  if (filter === "attention") return statusId === "failed";
  return true;
}

function countFor(entries: SessionListEntry[], filter: ListFilter): number {
  if (filter === "all") return entries.length;
  return entries.filter((e) => matchesFilter(e.statusId, filter)).length;
}

export function SessionList({
  entries,
  selectedId,
  onSelect,
  query,
  onQuery,
  filter,
  onFilter,
  dateRange,
  onDateRange,
}: Props) {
  const filtered = entries.filter((e) => {
    if (!matchesFilter(e.statusId, filter)) return false;
    if (query) {
      const q = query.toLowerCase();
      const hay =
        `${e.session.patient_id} ${e.session.encounter_id} ${e.session.department_id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="janus-list-pane">
      <div className="janus-filter-bar">
        <div className="janus-filter-search">
          <Search />
          <input
            type="text"
            placeholder="Search this list…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <div className="janus-filter-chips">
          {FILTERS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                type="button"
                className={`janus-chip ${filter === f.id ? "active" : ""}`}
                onClick={() => onFilter(f.id)}
              >
                {Icon ? <Icon /> : null}
                <span>{f.label}</span>
                <span className="janus-chip-count">{countFor(entries, f.id)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={dateRange}
            onChange={(e) => onDateRange(e.target.value)}
            style={{
              border: "1.5px solid var(--janus-border)",
              borderRadius: "var(--janus-radius-input)",
              padding: "5px 8px",
              fontSize: 12,
              fontFamily: "inherit",
              color: "var(--janus-text-light)",
              background: "var(--janus-white)",
              cursor: "pointer",
            }}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      <div className="janus-list-meta">
        <span>
          {filtered.length} encounter{filtered.length === 1 ? "" : "s"}
        </span>
        <button type="button" className="janus-sort-btn">
          Newest first
          <ChevronDown />
        </button>
      </div>

      <div className="janus-session-list">
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "var(--janus-text-light)",
              fontSize: 13,
            }}
          >
            No encounters match your filters.
          </div>
        ) : (
          filtered.map((entry) => (
            <Row
              key={entry.session.id}
              entry={entry}
              selected={selectedId === entry.session.id}
              onClick={() => onSelect(entry.session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  entry,
  selected,
  onClick,
}: {
  entry: SessionListEntry;
  selected: boolean;
  onClick: () => void;
}) {
  const status = STATUS[entry.statusId];
  const { session, wordCount: words } = entry;
  return (
    <button
      type="button"
      className={`janus-session-row ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="janus-session-row-top">
        <div className="janus-session-patient">{session.patient_id}</div>
        <StatusPill status={status} />
      </div>
      <div className="janus-session-encounter" title={session.encounter_id}>
        Encounter {session.encounter_id}
        {session.department_id ? ` · Dept ${session.department_id}` : ""}
      </div>
      <div className="janus-session-meta">
        <span title="Department">
          <Clock />
          {new Date(session.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        {words > 0 ? (
          <span title="Transcript word count">
            <FileText />
            {words.toLocaleString()} w
          </span>
        ) : null}
        <span
          style={{ marginLeft: "auto" }}
          title={new Date(session.created_at).toLocaleString()}
        >
          {fmtRelative(session.created_at)}
        </span>
      </div>
    </button>
  );
}

// Build entries from raw sessions + a function that knows the approval state.
export function buildEntries(
  sessions: ScribeSession[],
  approvedCountFor: (id: string) => number,
): SessionListEntry[] {
  return sessions.map((s) => ({
    session: s,
    statusId: deriveStatusId(s, approvedCountFor(s.id)),
    wordCount: 0, // Word count comes from the detail endpoint; list rows show 0 until selected.
  }));
}

// Recompute word count once we have the detail for a session.
export function withWordCount(
  entry: SessionListEntry,
  transcript: string | undefined,
): SessionListEntry {
  return { ...entry, wordCount: wordCount(transcript) };
}
