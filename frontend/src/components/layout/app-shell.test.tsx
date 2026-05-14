import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell, type AppShellUser } from "./app-shell";
import type { UserRole } from "@/lib/queries";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

function renderAppShell(role: UserRole): RenderResult {
  const user: AppShellUser = {
    name: "Test User",
    email: "test@example.com",
    role,
  };

  return render(
    <MemoryRouter initialEntries={["/scribe"]}>
      <Routes>
        <Route element={<AppShell user={user} />}>
          <Route path="/scribe" element={<div>Scribe page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AppShell admin navigation", () => {
  it("shows Team navigation for admins", () => {
    renderAppShell("admin");

    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument();
  });

  it("hides Team navigation for non-admin users", () => {
    renderAppShell("staff");

    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
  });
});
