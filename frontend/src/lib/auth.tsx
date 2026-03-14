import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api";

interface AuthState {
  isAuthenticated: boolean;
  login: (email: string, password: string, tenantId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => !!api.getToken(),
  );

  const login = useCallback(
    async (email: string, password: string, tenantId: string) => {
      const res = await api.fetch<{ access_token: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password, tenant_id: tenantId }),
        },
      );
      api.setToken(res.access_token);
      setIsAuthenticated(true);
    },
    [],
  );

  const logout = useCallback(() => {
    api.setToken(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
