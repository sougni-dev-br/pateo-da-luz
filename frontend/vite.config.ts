import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendTarget = process.env.VITE_BACKEND_TARGET_URL ?? "http://127.0.0.1:3334";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5174),
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
