import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { useUpdateScribePatientId } from "./scribe-queries";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("./api", () => ({
  api: {
    fetch: mocks.fetch,
  },
}));

function createQueryClientWrapper(queryClient: QueryClient) {
  return function QueryClientWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  mocks.fetch.mockReset();
});

describe("useUpdateScribePatientId", () => {
  it("updates the patient id and invalidates scribe session queries", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    mocks.fetch.mockResolvedValue({});

    const { result } = renderHook(() => useUpdateScribePatientId(), {
      wrapper: createQueryClientWrapper(queryClient),
    });

    result.current.mutate({ sessionId: "session-1", patientId: "patient-9" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetch).toHaveBeenCalledWith(
      "/api/scribe/sessions/session-1/patient-id",
      {
        method: "PUT",
        body: JSON.stringify({ patient_id: "patient-9" }),
      },
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["scribeSessions", "session-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["scribeSessions"],
    });
  });
});
