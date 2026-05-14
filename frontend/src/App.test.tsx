import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import { type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { AdminRoute } from "./App";
import type { AppShellUser } from "@/components/layout/app-shell";
import type { UserRole } from "@/lib/queries";

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
