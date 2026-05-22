import type { ScribeSession } from "@/lib/scribe-queries";
import { deriveStatusId, isInPipeline } from "./status";
import type { StatusId } from "./types";

export type ListFilter =
  | "all"
  | "ready"
  | "in_pipeline"
  | "sent"
  | "attention"
  | "rejected";

export interface SessionListEntry {
  session: ScribeSession;
  statusId: StatusId;
  wordCount: number;
}

export function buildEntries(sessions: ScribeSession[]): SessionListEntry[] {
  return sessions.map((s) => ({
    session: s,
    statusId: deriveStatusId(s),
    wordCount: 0,
  }));
}

export function matchesFilter(statusId: StatusId, filter: ListFilter): boolean {
  if (filter === "all") return statusId !== "rejected";
  if (filter === "ready") return statusId === "ready";
  if (filter === "in_pipeline") return isInPipeline(statusId);
  if (filter === "sent") return statusId === "sent";
  if (filter === "attention") return statusId === "failed";
  if (filter === "rejected") return statusId === "rejected";
  return true;
}

export function countFor(
  entries: SessionListEntry[],
  filter: ListFilter,
): number {
  return entries.filter((e) => matchesFilter(e.statusId, filter)).length;
}

export function filterEntries(
  entries: SessionListEntry[],
  filter: ListFilter,
  query: string,
): SessionListEntry[] {
  return entries.filter((e) => {
    if (!matchesFilter(e.statusId, filter)) return false;
    if (query) {
      const q = query.toLowerCase();
      const hay =
        `${e.session.patient_id} ${e.session.encounter_id} ${e.session.department_id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
