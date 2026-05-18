import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "@/lib/auth";
import { StartupErrorBoundary, StartupErrorScreen } from "@/components/startup-error-boundary";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

function showStartupError(reason: unknown): void {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;

  const error = reason instanceof Error ? reason : new Error(String(reason));
  createRoot(root).render(
    <StartupErrorScreen
      title="Janus Dash couldn't start"
      message={error.message}
      details={error.stack}
    />,
  );
}

window.addEventListener("error", (event) => showStartupError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showStartupError(event.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StartupErrorBoundary>
            <App />
          </StartupErrorBoundary>
        </AuthProvider>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
