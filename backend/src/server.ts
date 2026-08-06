import { app } from "./app.js";
import { env } from "./config/env.js";
import { initBaileys } from "./modules/notifications/baileys.service.js";
import { startNoventaNoveCronScheduler } from "./modules/integrations/delivery/noventa-nove/noventa-nove-cron.service.js";

app.listen(env.port, () => {
  console.log(`CMV Loja backend running on http://localhost:${env.port}`);

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
