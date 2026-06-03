import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Keep frontend dev aligned with the repo-level .env used by the Go API and Makefile.
// Without this, `cd frontend && npm run dev` starts with an empty
// VITE_GOOGLE_CLIENT_ID and Google OAuth fails with "Missing required parameter: client_id".
const envDir = path.resolve(__dirname, "..");

export default defineConfig(({ mode }) => {
  // Vite does not put .env values on process.env, so read them explicitly
  // (prefix "" loads non-VITE_ vars like PORT/API_URL too).
  const env = loadEnv(mode, envDir, "");
  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      // Bind on all interfaces so localhost works over both IPv4 and IPv6.
      // Default binding is IPv6-only ([::1]), which breaks IPv4 127.0.0.1 clients.
      host: true,
      port: parseInt(env.VITE_PORT || "3000"),
      proxy: {
        "/api": {
          target: env.API_URL || `http://localhost:${env.PORT || "8080"}`,
          changeOrigin: true,
        },
      },
    },
  };
});
