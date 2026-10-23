import { prisma } from "../../../../config/database.js";
import { hasValidCredential } from "./noventa-nove-http-client.js";
import { importarCardapios } from "./noventa-nove-menu.service.js";
import { isSyncInFlight, runSmartSyncGuarded } from "./noventa-nove.service.js";
import { lojasComProblema } from "./noventa-nove-real-sync.service.js";

// Scheduler in-process do sync do 99 Food. Roda 1x/dia de madrugada (BRT),
// disparado no boot (server.ts) no mesmo padrão fire-and-forget do Baileys.
//
// Zero dependência: calcula os ms até o próximo horário e reencadeia com
// setTimeout. Reinicia junto com o deploy (aceitável — recalcula o próximo).
// 1 instância no Render Starter, então não há corrida entre múltiplos crons.
//
// Liga sozinho só em produção (NODE_ENV=production ou RENDER, que o Render
// define em todo serviço). Fora dela fica desligado: o banco local tem a
// credencial e as lojas reais da 99, e cada backend de desenvolvimento chamava a
// API real às 04:00 BRT junto com o de produção — a 99 aceita 1 chamada/20s.
// Desligar sem redeploy: NOVENTA_NOVE_CRON_ENABLED=false no painel do Render.
// Ligar num ambiente local, de propósito: NOVENTA_NOVE_CRON_ENABLED=true.

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3 (sem DST hoje)
const RUN_HOUR_BRT = 4; // 04:00 BRT — plataforma já fechou o dia anterior
const DAY_MS = 24 * 60 * 60 * 1000;
// Nos primeiros dias do mês, sincroniza TAMBÉM o mês anterior pra capturar
// repasses semanais que cruzam a virada e só fecham no início do mês seguinte.
const PREV_MONTH_GRACE_DAYS = 5;

// Depois do sync de vendas, a mesma rodada importa o cardápio (nome, categoria e preço por loja) para as fichas técnicas:
// o preço da 99 na ficha entra sozinho. Desligar só esta parte: NOVENTA_NOVE_MENU_CRON_ENABLED=false.
export function importacaoDoCardapioHabilitada(env: NodeJS.ProcessEnv): boolean {
  return env.NOVENTA_NOVE_MENU_CRON_ENABLED !== "false";
}

export function cronHabilitado(env: NodeJS.ProcessEnv): boolean {
  const flag = env.NOVENTA_NOVE_CRON_ENABLED;
  if (flag === "false") return false;
  if (flag === "true") return true;
  return env.NODE_ENV === "production" || Boolean(env.RENDER);
}

function isEnabled(): boolean {
  return cronHabilitado(process.env);
}

// "Agora" em BRT como Date (componentes UTC representam o relógio BRT).
function nowBrt(): Date {
  return new Date(Date.now() - BRT_OFFSET_MS);
}

// Instante (UTC) do último RUN_HOUR_BRT que já deveria ter rodado em `agora`.
export function inicioDaUltimaRodadaEsperada(agora: Date): Date {
  const brt = new Date(agora.getTime() - BRT_OFFSET_MS);
  let slot = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), RUN_HOUR_BRT, 0, 0);
  if (brt.getTime() < slot) slot -= DAY_MS; // ainda não deu 04:00 hoje → vale o de ontem
  return new Date(slot + BRT_OFFSET_MS);
}

// O agendamento é um setTimeout em memória: restart/deploy perto das 04:00 engole a rodada do dia.
// No boot, se o último sync REAL terminou antes da rodada que deveria ter acontecido, ela foi perdida.
// Só conta rodada do cron (triggeredByUserId nulo) que terminou em SUCCESS: um sync manual (de qualquer mês)
// ou uma rodada que falhou não pode esconder a perda. Rodada PARTIAL é refeita a cada restart até dar certo.
export function rodadaPerdida(ultimaRodadaTerminouEm: Date | null, agora: Date): boolean {
  if (!ultimaRodadaTerminouEm) return true;
  return ultimaRodadaTerminouEm.getTime() < inicioDaUltimaRodadaEsperada(agora).getTime();
}

// Dá tempo do boot (migrations, conexões) assentar antes de gastar a cota da 99.
const RECOVERY_DELAY_MS = 2 * 60 * 1000;

async function recuperarRodadaPerdida(): Promise<void> {
  const ultima = await prisma.noventaNoveSyncLog.findFirst({
    where: { syncType: "REAL", status: "SUCCESS", triggeredByUserId: null, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true }
  });
  if (!rodadaPerdida(ultima?.finishedAt ?? null, new Date())) return;
  console.info("[99cron] rodada das 04:00 perdida (restart/deploy) — recuperando agora.");
  await runDailySync();
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
      // Rodada sem ninguém olhando: loja que falhou (inclusive depois dos retries) não pode passar por sucesso.
      const problemas = result.real ? lojasComProblema(result.real.perStore) : [];
      if (problemas.length > 0) console.error(`[99cron] ${label}: lojas com problema — ${problemas.join(" | ")}`);
    } catch (error: unknown) {
      console.error(`[99cron] ${label}: falha no sync —`, error instanceof Error ? error.message : error);
    }
  }

  // Só depois do sync de vendas: a 99 aceita 1 chamada a cada 20 s e as duas rodadas não podem competir.
  await runDailyMenuImport();
}

async function runDailyMenuImport(): Promise<void> {
  if (!importacaoDoCardapioHabilitada(process.env)) return;
  try {
    const result = await importarCardapios();
    const lojas = result.perStore ?? [];
    const resumo = lojas.map((loja) => `${loja.storeLabel}: ${loja.status} (${loja.listagensCriadas} novas, ${loja.listagensAtualizadas} atualizadas, ${loja.pratosCriados} pratos novos)${loja.status === "SUCCESS" ? "" : ` — ${loja.message}`}`).join("; ");
    console.info(`[99cron] cardápio importado — ${resumo || "nenhuma loja"}.`);
  } catch (error: unknown) {
    console.error("[99cron] falha ao importar o cardápio —", error instanceof Error ? error.message : error);
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
    console.info("[99cron] desligado — só liga em produção ou com NOVENTA_NOVE_CRON_ENABLED=true.");
    return;
  }
  if (timer) return; // já agendado
  scheduleNext();
  const recovery = setTimeout(() => {
    recuperarRodadaPerdida().catch((error) => console.error("[99cron] falha na recuperação da rodada:", error));
  }, RECOVERY_DELAY_MS);
  recovery.unref?.();
}
