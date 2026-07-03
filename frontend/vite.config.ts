import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendTarget = process.env.VITE_BACKEND_TARGET_URL ?? "http://127.0.0.1:3334";

// Chunks vendor separam dependencias grandes que mudam raramente do bundle
// principal — cache do navegador de longo prazo para elas, index recarrega
// mais leve quando o app muda. Nao dividimos por rota aqui (isso e Fase 6).
const VENDOR_CHUNKS: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom", "react-router-dom", "scheduler"],
  "vendor-motion": ["framer-motion"],
  "vendor-radix": ["@radix-ui/"]
};

function pickVendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  for (const [chunk, pkgs] of Object.entries(VENDOR_CHUNKS)) {
    if (pkgs.some((pkg) => id.includes(`node_modules/${pkg}`))) return chunk;
  }
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return pickVendorChunk(id);
        }
      }
    }
  },
  server: {
    port: Number(process.env.PORT ?? 5174),
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", "http://localhost:5174");
          });
        }
      }
    }
  }
});
