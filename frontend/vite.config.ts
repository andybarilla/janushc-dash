import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  // Keep frontend dev aligned with the repo-level .env used by the Go API and Makefile.
  // Without this, `cd frontend && npm run dev` starts with an empty
  // VITE_GOOGLE_CLIENT_ID and Google OAuth fails with "Missing required parameter: client_id".
  envDir: path.resolve(__dirname, ".."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT || "3000"),
    proxy: {
      "/api": {
        target: process.env.API_URL || `http://localhost:${process.env.PORT || "8080"}`,
        changeOrigin: true,
      },
    },
  },
});
