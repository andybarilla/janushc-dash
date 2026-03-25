import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const [error, setError] = useState("");
  const { loginWithGoogle, isAuthenticated } = useAuth();
  const navigate = useNavigate();

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
          <GoogleLogin
            onSuccess={async (response) => {
              if (!response.credential) {
                setError("No credential received from Google");
                return;
              }
              try {
                await loginWithGoogle(response.credential);
                navigate("/approvals");
              } catch {
                setError("Sign in failed. Make sure your @janushc.com account is registered.");
              }
            }}
            onError={() => setError("Google sign in failed")}
            theme="filled_black"
            size="large"
            width="280"
          />
        </div>
      </div>
    </div>
  );
}
