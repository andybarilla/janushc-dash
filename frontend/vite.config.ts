import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
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
