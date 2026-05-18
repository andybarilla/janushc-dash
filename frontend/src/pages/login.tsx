import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const [error, setError] = useState("");
  const { loginWithGoogle, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (isAuthenticated) return <Navigate to="/approvals" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold mb-2 text-foreground">Janus Healthcare</h1>
        <p className="text-muted-foreground text-sm mb-8">Sign in to continue</p>
        <div className="bg-card border border-border shadow rounded-lg p-6 flex flex-col items-center gap-4">
          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded text-sm w-full">
              {error}
            </div>
          )}
          {googleClientId ? (
            <GoogleLogin
              onSuccess={async (response) => {
                if (!response.credential) {
                  setError("No credential received from Google");
                  return;
                }
                try {
                  await loginWithGoogle(response.credential);
                  navigate("/approvals");
                } catch (err) {
                  setError(formatLoginError(err));
                }
              }}
              onError={() => setError("Google sign in failed")}
              theme="filled_black"
              size="large"
              width="280"
            />
          ) : (
            <div className="bg-destructive/10 text-destructive p-3 rounded text-sm w-full">
              Google login is not configured. Set VITE_GOOGLE_CLIENT_ID in the repo .env and restart Vite.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatLoginError(err: unknown) {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    "message" in err
  ) {
    const { status, message } = err as { status: number; message: string };
    const cleanMessage = message.trim();
    if (status === 403) {
      return "Sign in failed. Your Google account is not registered for this app.";
    }
    if (status === 401) {
      return `Google sign in failed: ${cleanMessage || "token verification failed"}`;
    }
    return `Sign in failed: ${cleanMessage || `HTTP ${status}`}`;
  }
  return "Sign in failed. Please try again.";
}
