import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { api } from "./api";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  loginWithGoogle: (idToken: string) => Promise<void>;
  setUser: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!api.getToken());
  const [user, setUser] = useState<User | null>(null);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const res = await api.fetch<{ access_token: string }>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ id_token: idToken }),
    });
    api.setToken(res.access_token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    api.setToken(null);
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, loginWithGoogle, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
