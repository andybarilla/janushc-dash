import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import App, { AdminRoute } from "./App";
import type { AppShellUser } from "@/components/layout/app-shell";
import type { UserRole } from "@/lib/queries";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useCurrentUser: vi.fn(),
  useManagedUsers: vi.fn(),
  useCreateUser: vi.fn(),
  setUser: vi.fn(),
  logout: vi.fn(),
  refetchManagedUsers: vi.fn(),
  resetCreateUser: vi.fn(),
  mutateAsyncCreateUser: vi.fn(),
}));

const adminUser = {
  id: "user-admin",
  name: "Admin User",
  email: "admin@example.com",
  role: "admin" as const,
};

vi.mock("@/lib/auth", () => ({
  useAuth: mocks.useAuth,
}));

vi.mock("@/lib/queries", () => ({
  useCurrentUser: mocks.useCurrentUser,
  useManagedUsers: mocks.useManagedUsers,
  useCreateUser: mocks.useCreateUser,
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

function renderAdminRoute(role: UserRole): RenderResult {
  const user: AppShellUser = {
    name: "Test User",
    email: "test@example.com",
    role,
  };

  function LayoutWithContext(): ReactElement {
    return <Outlet context={{ user }} />;
  }

  return render(
    <MemoryRouter initialEntries={["/team"]}>
      <Routes>
        <Route element={<LayoutWithContext />}>
          <Route
            path="/team"
            element={
              <AdminRoute>
                <div>Team route</div>
              </AdminRoute>
            }
          />
          <Route path="/scribe" element={<div>Scribe route</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mockFunction of Object.values(mocks)) {
    mockFunction.mockClear();
  }

  mocks.useAuth.mockReturnValue({
    isAuthenticated: true,
    user: adminUser,
    loginWithGoogle: vi.fn(),
    setUser: mocks.setUser,
    logout: mocks.logout,
  });
  mocks.useCurrentUser.mockReturnValue({
    data: adminUser,
    isLoading: false,
  });
  mocks.useManagedUsers.mockReturnValue({
    data: [
      {
        id: "user-admin",
        name: "Admin User",
        email: "admin@example.com",
        role: "admin",
        created_at: "2026-05-14T00:00:00Z",
      },
      {
        id: "user-staff",
        name: "Staff User",
        email: "staff@example.com",
        role: "staff",
        created_at: "2026-05-14T00:00:00Z",
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.refetchManagedUsers,
  });
  mocks.useCreateUser.mockReturnValue({
    isPending: false,
    reset: mocks.resetCreateUser,
    mutateAsync: mocks.mutateAsyncCreateUser,
  });
  window.history.pushState(null, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("AdminRoute", () => {
  it("renders team route content for admins", () => {
    renderAdminRoute("admin");

    expect(screen.getByText("Team route")).toBeInTheDocument();
  });

  it("redirects non-admin users from /team to /scribe", () => {
    renderAdminRoute("physician");

    expect(screen.getByText("Scribe route")).toBeInTheDocument();
    expect(screen.queryByText("Team route")).not.toBeInTheDocument();
  });
});

describe("App team route", () => {
  it("uses Janus styling for the authenticated route loading state", () => {
    window.history.pushState(null, "", "/team");
    mocks.useCurrentUser.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<App />);

    const loadingStatus = screen.getByRole("status", { name: "Loading Janus" });
    expect(loadingStatus).toHaveClass("janus-route-loading-card");
    expect(loadingStatus.closest(".janus-scope")).not.toBeNull();
  });

  it("renders the real Team page for authenticated admins", () => {
    window.history.pushState(null, "", "/team");

    render(<App />);

    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(
      screen.getByText("Manage who can access Janus for your practice."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add user" })).toBeInTheDocument();
  });
});
