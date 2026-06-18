import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxTable } from "./inbox-table";
import type { SessionListEntry } from "./scribe-filters";
import type { ScribeSession } from "@/lib/scribe-queries";
import type { StatusId } from "./types";

function entry(
  id: string,
  patient: string,
  statusId: StatusId,
  label?: string,
): SessionListEntry {
  const session: ScribeSession = {
    id,
    patient_id: patient,
    encounter_id: `enc-${id}`,
    department_id: "1",
    label,
    status: "x",
    created_at: "2026-05-21T10:00:00Z",
    approved_count: 0,
  };
  return { session, statusId, wordCount: 0 };
}

const entries: SessionListEntry[] = [
  entry("1", "alice", "ready"),
  entry("2", "bob", "sent"),
];

afterEach(() => cleanup());

function noop() {}

describe("InboxTable", () => {
  it("renders a row per entry", () => {
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("shows the patient id without transcript label copy", () => {
    render(
      <InboxTable
        entries={[entry("1", "patient-123", "ready", "Transcript A")]}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Patient" })).toBeInTheDocument();
    expect(screen.getByText("patient-123")).toBeInTheDocument();
    expect(screen.queryByText("Transcript A")).not.toBeInTheDocument();
  });

  it("narrows rows by the active filter", () => {
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={noop}
        filter="ready"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("calls onOpen with the session id when a row is clicked", () => {
    const onOpen = vi.fn();
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={onOpen}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByText("alice"));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("calls onQuery as the user types in search", () => {
    const onQuery = vi.fn();
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={onQuery}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search this list…"), {
      target: { value: "ali" },
    });
    expect(onQuery).toHaveBeenCalledWith("ali");
  });

  it("shows the empty state when nothing matches", () => {
    render(
      <InboxTable
        entries={[]}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    expect(
      screen.getByText("No encounters match your filters."),
    ).toBeInTheDocument();
  });
});
