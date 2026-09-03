import { app } from "./app.js";
import { env } from "./config/env.js";
import { initBaileys } from "./modules/notifications/baileys.service.js";
import { startNoventaNoveCronScheduler } from "./modules/integrations/delivery/noventa-nove/noventa-nove-cron.service.js";

app.listen(env.port, () => {
  console.log(`CMV Loja backend running on http://localhost:${env.port}`);

  // Datas de competencia dependem do fuso do processo (new Date(ano, mes, dia)).
  // Um fuso diferente do de producao faz o mesmo lancamento cair em outro mes —
  // ja aconteceu: jun/2026 gravou 271 vencimentos as 03:00Z e o resto as 00:00Z.
  // Aviso alto, nao silencioso.
  const fusoAtual = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMinutos = new Date().getTimezoneOffset();
  if (offsetMinutos !== 0) {
    console.warn(
      `[fuso] ATENCAO: processo rodando em ${fusoAtual} (UTC${offsetMinutos > 0 ? "-" : "+"}${Math.abs(offsetMinutos / 60)}), ` +
      "nao em UTC. Datas de competencia vao divergir de producao. Defina TZ=UTC."
    );
  }

  // WhatsApp Baileys: iniciar em fire-and-forget. Se falhar, o backend
  // continua atendendo o ERP normalmente — WhatsApp fica offline até
  // reinício via POST /notifications/whatsapp/restart ou até o próximo
  // deploy. Nunca queremos que uma falha do WA quebre o restaurante.
  initBaileys().catch((error) => {
    console.error("[baileys] boot falhou (WhatsApp offline):", error);
  });

  // Sync diário do 99 Food (in-process, 04:00 BRT). Guarda contra
  // concorrência com o sync manual. Desligar via NOVENTA_NOVE_CRON_ENABLED=false.
  startNoventaNoveCronScheduler();
});
