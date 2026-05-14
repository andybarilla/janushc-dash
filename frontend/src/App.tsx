import { useEffect, type ReactElement, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useOutletContext,
} from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCurrentUser } from "@/lib/queries";
import { AppShell, type AppShellUser } from "@/components/layout/app-shell";
import LoginPage from "@/pages/login";
import ScribePage from "@/pages/scribe";
import TeamPage from "@/pages/team";

interface AdminRouteProps {
  children: ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps): ReactElement {
  const { user } = useOutletContext<{ user: AppShellUser }>();

  if (user.role !== "admin") {
    return <Navigate to="/scribe" replace />;
  }

  return <>{children}</>;
}

function AuthenticatedLayout(): ReactElement {
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

export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthenticatedLayout />}>
          <Route path="/scribe" element={<ScribePage />} />
          <Route
            path="/team"
            element={
              <AdminRoute>
                <TeamPage />
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/scribe" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
