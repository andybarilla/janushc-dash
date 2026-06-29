import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveRecordingDraft } from "./use-active-recording-draft";

const mocks = vi.hoisted(() => ({
  listRecordingDrafts: vi.fn(),
}));

vi.mock("@/lib/recording-drafts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recording-drafts")>(
    "@/lib/recording-drafts",
  );
  return { ...actual, listRecordingDrafts: mocks.listRecordingDrafts };
});

const draft = {
  draftId: "active-mobile-recording",
  ownerUserId: "user-1",
  mimeType: "audio/webm",
  fileExtension: "webm",
  patientId: "patient-2",
  appointmentId: "appt-2",
  patientName: "John Roe",
  appointmentTime: "10:00",
  departmentId: "dept-2",
  autoTranscribe: true,
  startedAt: "2026-06-29T14:42:00.000Z",
  updatedAt: "2026-06-29T14:44:00.000Z",
  elapsedSeconds: 75,
  nextChunkIndex: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("useActiveRecordingDraft", () => {
  it("returns a draft owned by the current user", async () => {
    mocks.listRecordingDrafts.mockResolvedValue([draft]);
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).toEqual(draft);
  });

  it("returns null when the inbox is empty", async () => {
    mocks.listRecordingDrafts.mockResolvedValue([]);
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).toBeNull();
  });

  it("returns null when there is no current user", async () => {
    const { result } = renderHook(() => useActiveRecordingDraft(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.draft).toBeNull();
    expect(mocks.listRecordingDrafts).not.toHaveBeenCalled();
  });

  it("re-reads the draft when refresh is called", async () => {
    mocks.listRecordingDrafts.mockResolvedValueOnce([draft]).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useActiveRecordingDraft("user-1"));
    await waitFor(() => expect(result.current.draft).toEqual(draft));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.draft).toBeNull());
  });
});
