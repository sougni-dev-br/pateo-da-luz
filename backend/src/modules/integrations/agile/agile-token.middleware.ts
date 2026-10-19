import { criarTokenDeMaquina } from "../token-de-maquina.middleware.js";

// O agente que roda na máquina PDVTOUCH não é um usuário — é uma máquina.
// Autenticamos por header X-Agile-Token contra a env var AGILE_INGEST_TOKEN.
// Qualquer request para /sync ou /heartbeat sem o token correto é rejeitada com 401 antes de
// qualquer trabalho.
export const requireAgileToken = criarTokenDeMaquina({
  envVar: "AGILE_INGEST_TOKEN",
  header: "x-agile-token",
  mensagemNaoConfigurado: "Integração Agile PDV não configurada no servidor. Defina AGILE_INGEST_TOKEN."
});
