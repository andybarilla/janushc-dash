import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getToken: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("./api", () => ({
  api: {
    fetch: mocks.fetch,
    getToken: mocks.getToken,
    setToken: mocks.setToken,
  },
}));

function AuthActions(): ReactElement {
  const { loginWithGoogle, logout } = useAuth();

  return (
    <>
      <button onClick={() => void loginWithGoogle("google-token")}>Login</button>
      <button onClick={logout}>Logout</button>
    </>
  );
}

function renderAuthProvider(queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthActions />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.getToken.mockReset();
  mocks.setToken.mockReset();
  mocks.getToken.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe("AuthProvider", () => {
  it("clears React Query cache after Google login", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["managedUsers"], [{ id: "previous-tenant-user" }]);
    mocks.fetch.mockResolvedValue({ access_token: "new-token" });

    renderAuthProvider(queryClient);
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(mocks.setToken).toHaveBeenCalledWith("new-token"));
    expect(queryClient.getQueryData(["managedUsers"])).toBeUndefined();
  });

  it("clears React Query cache on logout", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["managedUsers"], [{ id: "current-tenant-user" }]);

    renderAuthProvider(queryClient);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    expect(mocks.setToken).toHaveBeenCalledWith(null);
    expect(queryClient.getQueryData(["managedUsers"])).toBeUndefined();
  });
});
