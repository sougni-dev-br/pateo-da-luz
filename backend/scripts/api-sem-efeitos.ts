/**
 * Sobe SÓ a API HTTP do backend, sem nenhum efeito colateral externo: sem WhatsApp (Baileys), sem os crons do
 * 99 Food e sem as rotinas de expurgo. Serve para ensaiar contra uma CÓPIA de produção: o banco copiado guarda
 * credenciais de integração e a sessão do WhatsApp, e o `server.ts` normal as usaria de verdade.
 *
 * Uso:  npx tsx --env-file=<env-da-copia> scripts/api-sem-efeitos.ts
 *
 * Recusa subir se o banco não for local, para nunca ser apontado para produção por engano.
 */
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";

const banco = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();

if (!banco || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(banco.hostname)) {
  console.error("Recusado: DATABASE_URL não aponta para uma máquina local. Esta API é só para ensaio em cópia.");
  process.exit(1);
}

app.listen(env.port, () => {
  console.log(`API de ensaio (sem WhatsApp, sem crons) em http://localhost:${env.port} -> ${banco.hostname}:${banco.port}${banco.pathname}`);
});
