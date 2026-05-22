import {
  Ban,
  Check,
  CircleDot,
  Loader,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { fmtRelative } from "./format";
import { StatusPill } from "./status-pill";
import { STATUS } from "./status";
import {
  countFor,
  filterEntries,
  type ListFilter,
  type SessionListEntry,
} from "./scribe-filters";

interface Props {
  entries: SessionListEntry[];
  query: string;
  onQuery: (q: string) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  dateRange: string;
  onDateRange: (range: string) => void;
  onOpen: (id: string) => void;
  loading: boolean;
}

const FILTERS: { id: ListFilter; label: string; icon?: LucideIcon }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready", icon: CircleDot },
  { id: "in_pipeline", label: "In pipeline", icon: Loader },
  { id: "sent", label: "Sent", icon: Check },
  { id: "attention", label: "Needs attn", icon: TriangleAlert },
  { id: "rejected", label: "Rejected", icon: Ban },
];

export function InboxTable({
  entries,
  query,
  onQuery,
  filter,
  onFilter,
  dateRange,
  onDateRange,
  onOpen,
  loading,
}: Props) {
  const filtered = filterEntries(entries, filter, query);

  return (
    <div className="janus-inbox">
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

      <div className="janus-inbox-table-wrap">
        <table className="janus-inbox-table">
          <thead>
            <tr>
              <th>Patient / Transcript</th>
              <th>Encounter</th>
              <th>Dept</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="janus-inbox-empty">
                  Loading encounters…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="janus-inbox-empty">
                  No encounters match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr
                  key={entry.session.id}
                  className="janus-inbox-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(entry.session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(entry.session.id);
                    }
                  }}
                >
                  <td className="janus-inbox-patient">
                    {entry.session.patient_id}
                  </td>
                  <td>{entry.session.encounter_id}</td>
                  <td>{entry.session.department_id || "—"}</td>
                  <td>
                    <StatusPill status={STATUS[entry.statusId]} />
                  </td>
                  <td
                    title={new Date(
                      entry.session.created_at,
                    ).toLocaleString()}
                  >
                    {fmtRelative(entry.session.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
