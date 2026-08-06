import { prisma } from "../../../../config/database.js";
import { hasValidCredential } from "./noventa-nove-http-client.js";
import { isSyncInFlight, runSmartSyncGuarded } from "./noventa-nove.service.js";

// Scheduler in-process do sync do 99 Food. Roda 1x/dia de madrugada (BRT),
// disparado no boot (server.ts) no mesmo padrão fire-and-forget do Baileys.
//
// Zero dependência: calcula os ms até o próximo horário e reencadeia com
// setTimeout. Reinicia junto com o deploy (aceitável — recalcula o próximo).
// 1 instância no Render Starter, então não há corrida entre múltiplos crons.
//
// Desligar sem redeploy: NOVENTA_NOVE_CRON_ENABLED=false no painel do Render.

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3 (sem DST hoje)
const RUN_HOUR_BRT = 4; // 04:00 BRT — plataforma já fechou o dia anterior
const DAY_MS = 24 * 60 * 60 * 1000;
// Nos primeiros dias do mês, sincroniza TAMBÉM o mês anterior pra capturar
// repasses semanais que cruzam a virada e só fecham no início do mês seguinte.
const PREV_MONTH_GRACE_DAYS = 5;

function isEnabled(): boolean {
  return process.env.NOVENTA_NOVE_CRON_ENABLED !== "false";
}

// "Agora" em BRT como Date (componentes UTC representam o relógio BRT).
function nowBrt(): Date {
  return new Date(Date.now() - BRT_OFFSET_MS);
}

// ms até o próximo RUN_HOUR_BRT.
function msUntilNextRun(): number {
  const now = nowBrt().getTime();
  const d = new Date(now);
  let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_BRT, 0, 0);
  if (now >= next) next += DAY_MS; // já passou hoje → amanhã
  return next - now;
}

// Períodos a sincronizar: mês corrente + (mês anterior nos primeiros dias).
function periodsToSync(ref: Date): Array<{ year: number; month: number }> {
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth() + 1;
  const periods = [{ year, month }];
  if (ref.getUTCDate() <= PREV_MONTH_GRACE_DAYS) {
    periods.push({ year: month === 1 ? year - 1 : year, month: month === 1 ? 12 : month - 1 });
  }
  return periods;
}

async function runDailySync(): Promise<void> {
  if (!isEnabled()) return;

  // Pula silenciosamente se não há o que sincronizar de verdade (sem
  // credencial ou só lojas PENDENTE) — evita poluir o log com mock diário.
  const [credentialOk, realStores] = await Promise.all([
    hasValidCredential(),
    prisma.deliveryStore.count({
      where: { platform: "NOVENTA_NOVE", active: true, NOT: { externalId: { startsWith: "PENDENTE-" } } }
    })
  ]);
  if (!credentialOk || realStores === 0) {
    console.info("[99cron] sem credencial/loja real — nada a sincronizar.");
    return;
  }
  // Não enfileira atrás de um sync manual em andamento — pula esta rodada
  // (a próxima é amanhã; o sync é idempotente).
  if (isSyncInFlight()) {
    console.info("[99cron] sync manual/anterior em andamento — pulando esta rodada.");
    return;
  }

  for (const p of periodsToSync(nowBrt())) {
    const label = `${p.year}-${String(p.month).padStart(2, "0")}`;
    try {
      const result = await runSmartSyncGuarded(null, p.year, p.month);
      const persisted = result.mode === "REAL" ? (result.real?.totalPersisted ?? 0) : 0;
      console.info(`[99cron] ${label}: sync ${result.mode} — ${persisted} persistidos.`);
    } catch (error: unknown) {
      console.error(`[99cron] ${label}: falha no sync —`, error instanceof Error ? error.message : error);
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleNext(): void {
  const delay = msUntilNextRun();
  timer = setTimeout(() => {
    runDailySync()
      .catch((error) => console.error("[99cron] erro inesperado:", error))
      .finally(scheduleNext);
  }, delay);
  // Não segura o processo vivo só por causa deste timer (o app.listen segura).
  timer.unref?.();
  console.info(`[99cron] próxima rodada em ~${(delay / 3_600_000).toFixed(1)}h (${RUN_HOUR_BRT}:00 BRT).`);
}

// Ponto de entrada — chamado no boot (server.ts), fire-and-forget.
export function startNoventaNoveCronScheduler(): void {
  if (!isEnabled()) {
    console.info("[99cron] desabilitado (NOVENTA_NOVE_CRON_ENABLED=false).");
    return;
  }
  if (timer) return; // já agendado
  scheduleNext();
}
