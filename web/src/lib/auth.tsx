"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, tenantId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("token");
    if (stored) {
      setToken(stored);
      api.setToken(stored);
    }
  }, []);

  const login = async (email: string, password: string, tenantId: string) => {
    const res = await api.fetch<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, tenant_id: tenantId }),
    });
    setToken(res.access_token);
    api.setToken(res.access_token);
    localStorage.setItem("token", res.access_token);
  };

  const logout = () => {
    setToken(null);
    api.setToken(null);
    localStorage.removeItem("token");
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
