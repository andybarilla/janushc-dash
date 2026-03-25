import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCurrentUser } from "@/lib/queries";
import { AppShell } from "@/components/layout/app-shell";
import { getNavForRole } from "@/components/layout/nav-config";
import LoginPage from "@/pages/login";
import ApprovalsPage from "@/pages/approvals";

function AuthenticatedLayout() {
  const { isAuthenticated, setUser } = useAuth();
  const { data: user, isLoading } = useCurrentUser(isAuthenticated);

  useEffect(() => {
    if (user) setUser(user);
  }, [user, setUser]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return <AppShell user={user} />;
}

function DefaultRedirect() {
  const { user } = useAuth();
  const nav = getNavForRole(user?.role || "");
  const first = nav[0];
  const defaultPath = first ? first.path : "/login";
  return <Navigate to={defaultPath} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthenticatedLayout />}>
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
