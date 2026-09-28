import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Fuso da loja, fixado antes de os workers nascerem (herdam o ambiente). Sem
// isso, numa maquina em UTC os testes de data local (src/lib/__tests__/datas.test.ts)
// passariam ate com toISOString. test.env chega tarde demais para o fuso.
process.env.TZ = "America/Sao_Paulo";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: true,
  },
});
