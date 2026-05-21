import { describe, expect, it } from "vitest";
import {
  matchesFilter,
  countFor,
  filterEntries,
  type SessionListEntry,
} from "./scribe-filters";
import type { ScribeSession } from "@/lib/scribe-queries";
import type { StatusId } from "./types";

function entry(id: string, patient: string, statusId: StatusId): SessionListEntry {
  const session: ScribeSession = {
    id,
    patient_id: patient,
    encounter_id: `enc-${id}`,
    department_id: "1",
    status: "x",
    created_at: "2026-05-21T10:00:00Z",
    approved_count: 0,
  };
  return { session, statusId, wordCount: 0 };
}

const entries: SessionListEntry[] = [
  entry("1", "alice", "ready"),
  entry("2", "bob", "sent"),
  entry("3", "carol", "rejected"),
];

describe("matchesFilter", () => {
  it("excludes rejected from 'all'", () => {
    expect(matchesFilter("ready", "all")).toBe(true);
    expect(matchesFilter("rejected", "all")).toBe(false);
  });

  it("matches a specific status filter", () => {
    expect(matchesFilter("sent", "sent")).toBe(true);
    expect(matchesFilter("ready", "sent")).toBe(false);
  });
});

describe("countFor", () => {
  it("counts entries matching a filter", () => {
    expect(countFor(entries, "all")).toBe(2);
    expect(countFor(entries, "ready")).toBe(1);
    expect(countFor(entries, "rejected")).toBe(1);
  });
});

describe("filterEntries", () => {
  it("applies the status filter", () => {
    const result = filterEntries(entries, "ready", "");
    expect(result.map((e) => e.session.id)).toEqual(["1"]);
  });

  it("applies a case-insensitive query against patient/encounter/dept", () => {
    const result = filterEntries(entries, "all", "BOB");
    expect(result.map((e) => e.session.id)).toEqual(["2"]);
  });

  it("returns 'all' minus rejected when no query", () => {
    const result = filterEntries(entries, "all", "");
    expect(result.map((e) => e.session.id)).toEqual(["1", "2"]);
  });
});
