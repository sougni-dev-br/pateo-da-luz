import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../config/database.js";
import { assertPeriodWritableForDate } from "../../../cmv-real/cmv-real.service.js";
import { isPeriodLockedError } from "../../../cmv-real/period-locked-error.js";
import { auditLog } from "../../../security/security-utils.js";
import { ErroDeImportacao } from "../keeta/erro-de-importacao.js";
import { verificarTamanhoDoZip } from "../keeta/zip-seguro.js";
import { chaveDaLoja, lojaDaDescricao } from "./ifood-receita.js";
import {
  lerConciliacaoIfood,
  planejarLinhasIfood,
  type ItemDoPlanoIfood,
  type LinhaExistente,
  type LojaIfoodMes,
  type SemanaDeRepasse
} from "./ifood-conciliacao-import.js";

const AUDIT_ACTION = "REVENUE_IMPORT_IFOOD";
const SOURCE_PLATFORM = "iFood";
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
const NOME_MAXIMO_NA_AUDITORIA = 200;
const TIMEOUT_DA_GRAVACAO_MS = 90_000;
const TIMEOUT_DA_LEITURA_MS = 45_000;
/** Serializa importações do iFood: duas confirmações simultâneas não se atropelam. */
const CHAVE_DO_LOCK = "ifood-import";

type Banco = Prisma.TransactionClient | typeof prisma;
type LojaCadastrada = { id: string; nickname: string; externalId: string };

export type ItemPrevisto = ItemDoPlanoIfood & { nomeDaLoja: string | null; repassesNovos: number };

export type PrevisaoIfood = {
  arquivo: string;
  erros: string[];
  /** Informativos: não bloqueiam nem exigem confirmação. */
  avisos: string[];
  /** Números que podem estar errados: a gravação só acontece com a confirmação explícita deles. */
  alertas: string[];
  plano: ItemPrevisto[];
  mesesTravados: string[];
  totais: { criar: number; alterar: number; igual: number; conflito: number; travado: number; semLoja: number };
};

export type ResultadoIfood = PrevisaoIfood & { gravados: number; repassesGravados: number; gravadas: string[] };

// ── Leitura do arquivo ──────────────────────────────────────────────────────

function valorDaCelula(valor: unknown): unknown {
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const r = valor as Record<string, unknown>;
    if (r.result !== undefined && r.result !== null) return valorDaCelula(r.result);
    if (r.text !== undefined && r.text !== null) return valorDaCelula(r.text);
    if (Array.isArray(r.richText)) return r.richText.map((p) => String((p as Record<string, unknown>).text ?? "")).join("");
  }
  return valor;
}

/** Um parse de xlsx por vez: o plano free do Render tem pouca memória e prévia + confirmação pesam juntas. */
let filaDeLeitura: Promise<void> = Promise.resolve();
function lerArquivo(buffer: Buffer, nome: string): Promise<unknown[][]> {
  const vez = filaDeLeitura.then(() => comLimiteDeTempo(lerArquivoAgora(buffer, nome)));
  // A fila só guarda "terminou", nunca o resultado: não segura a tabela inteira na memória.
  filaDeLeitura = vez.then(() => undefined, () => undefined);
  return vez;
}

function comLimiteDeTempo<T>(trabalho: Promise<T>): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeita) => {
    temporizador = setTimeout(() => rejeita(new ErroDeImportacao("O arquivo demorou demais para ser lido.")), TIMEOUT_DA_LEITURA_MS);
  });
  return Promise.race([trabalho, limite]).finally(() => clearTimeout(temporizador));
}

async function lerArquivoAgora(buffer: Buffer, nome: string): Promise<unknown[][]> {
  if (buffer.length > TAMANHO_MAXIMO_BYTES) throw new ErroDeImportacao("Arquivo maior que 5 MB. Exporte um mês e uma loja por vez.");
  if (!/\.xlsx$/i.test(nome)) throw new ErroDeImportacao("Use o arquivo .xlsx do Relatório de Conciliação do portal do iFood.");
  verificarTamanhoDoZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ErroDeImportacao("O arquivo não é um .xlsx válido.");
  }
  const planilha = workbook.worksheets[0];
  if (!planilha) throw new ErroDeImportacao("A planilha está vazia.");
  const linhas: unknown[][] = [];
  // Guarda cada linha na posição dela na planilha: erro aponta o número que o Excel mostra, mesmo com linhas em branco.
  planilha.eachRow({ includeEmpty: false }, (row) => {
    linhas[row.number - 1] = (row.values as unknown[]).slice(1).map(valorDaCelula);
  });
  return Array.from(linhas, (l) => l ?? []);
}

// ── Datas ───────────────────────────────────────────────────────────────────

const dataUtc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymdDe = (d: Date) => d.toISOString().slice(0, 10);
/** "Hoje" no fuso de Brasília: depois das 21h o UTC já é o dia seguinte. */
const hojeYmd = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Último dia do mês; no mês em curso, o dia de hoje (o portal só dá o acumulado até aqui). */
export function dataDaLinhaMensal(competencia: string, hoje: string = hojeYmd()): string {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  return hoje < ultimo && hoje.slice(0, 7) === competencia ? hoje : ultimo;
}

// ── Lojas e linhas existentes ───────────────────────────────────────────────

async function lerLojas(db: Banco): Promise<LojaCadastrada[]> {
  return db.deliveryStore.findMany({ where: { platform: "IFOOD" }, select: { id: true, nickname: true, externalId: true } });
}

type ResolverLoja = (loja: LojaIfoodMes) => LojaCadastrada | null;

/**
 * Descobre qual loja cadastrada é cada loja do arquivo. O `merchantId` do cadastro pode estar como "PENDENTE-n"
 * (a integração oficial nunca foi liberada), então só ele não serve. O vínculo confiável vem das linhas que
 * já foram importadas: o id termina no código da loja (`ifood-import-AAAAMM-<código>`) e a descrição traz o nome.
 */
async function vinculosPelasLinhasAntigas(db: Banco, lojas: LojaIfoodMes[], cadastradas: LojaCadastrada[]): Promise<Map<string, LojaCadastrada>> {
  const vinculos = new Map<string, LojaCadastrada>();
  if (lojas.length === 0 || cadastradas.length === 0) return vinculos;
  const linhas = await db.revenueEntry.findMany({
    where: {
      sourcePlatform: { equals: SOURCE_PLATFORM, mode: "insensitive" },
      OR: lojas.map((l) => ({ id: { startsWith: "ifood-import-", endsWith: `-${l.lojaIdCurto}` } }))
    },
    select: { id: true, description: true }
  });
  for (const l of linhas) {
    const curto = l.id.match(/^ifood-import-\d{6}-(\d+)$/)?.[1];
    const nome = lojaDaDescricao(l.description);
    if (!curto || !nome || vinculos.has(curto)) continue;
    const cadastrada = cadastradas.find((c) => chaveDaLoja(c.nickname) === chaveDaLoja(nome));
    if (cadastrada) vinculos.set(curto, cadastrada);
  }
  return vinculos;
}

/** A loja do arquivo precisa estar cadastrada em Integrações Delivery: pelo merchantId ou pelo histórico de linhas importadas. */
function criarResolvedor(cadastradas: LojaCadastrada[], vinculos: Map<string, LojaCadastrada>): ResolverLoja {
  return (loja) =>
    cadastradas.find((l) => l.externalId === loja.lojaId || l.externalId === loja.lojaIdCurto) ?? vinculos.get(loja.lojaIdCurto) ?? null;
}

type LinhaDoBanco = {
  id: string;
  description: string | null;
  status: string;
  date: Date;
  competenceYear: number;
  competenceMonth: number;
  tickets: number;
  grossAmount: unknown;
  netAmount: unknown;
};

type Existentes = {
  /** Linhas consolidadas ativas que já pertencem a uma loja do arquivo. */
  reconhecidas: Array<LinhaExistente & { data: string }>;
  /** Qualquer outra linha de iFood viva no mês: se existir, gravar uma nova linha pode contar a receita em dobro. */
  naoReconhecidas: Array<{ id: string; competencia: string; status: string }>;
};

function idCurtoDaLinha(l: LinhaDoBanco, cadastradas: LojaCadastrada[], lojas: LojaIfoodMes[], resolver: ResolverLoja): string | null {
  const doId = l.id.match(/^ifood-import-\d{6}-(\d+)$/)?.[1];
  if (doId) return doId;
  const nome = lojaDaDescricao(l.description);
  if (!nome) return null;
  const cadastrada = cadastradas.find((c) => chaveDaLoja(c.nickname) === chaveDaLoja(nome));
  if (!cadastrada) return null;
  // Linha de outra loja cadastrada (que não está neste arquivo) também é reconhecida: só não é tocada.
  return lojas.find((x) => resolver(x)?.id === cadastrada.id)?.lojaIdCurto ?? cadastrada.externalId;
}

async function lerExistentes(db: Banco, lojas: LojaIfoodMes[], cadastradas: LojaCadastrada[], resolver: ResolverLoja): Promise<Existentes> {
  if (lojas.length === 0) return { reconhecidas: [], naoReconhecidas: [] };
  const competencias = [...new Set(lojas.map((l) => l.competencia))];
  const linhas = (await db.revenueEntry.findMany({
    where: {
      sourcePlatform: { equals: SOURCE_PLATFORM, mode: "insensitive" },
      status: { not: "CANCELLED" },
      OR: competencias.map((c) => ({ competenceYear: Number(c.slice(0, 4)), competenceMonth: Number(c.slice(5, 7)) }))
    },
    select: {
      id: true, description: true, status: true, date: true, competenceYear: true, competenceMonth: true,
      tickets: true, grossAmount: true, netAmount: true
    }
  })) as LinhaDoBanco[];

  const reconhecidas: Existentes["reconhecidas"] = [];
  const naoReconhecidas: Existentes["naoReconhecidas"] = [];
  for (const l of linhas) {
    const competencia = `${l.competenceYear}-${String(l.competenceMonth).padStart(2, "0")}`;
    const consolidada = l.status === "ACTIVE" && (l.description ?? "").includes("(consolidado do mes)");
    const loja = consolidada ? idCurtoDaLinha(l, cadastradas, lojas, resolver) : null;
    if (loja) {
      reconhecidas.push({
        id: l.id, loja, competencia, orders: l.tickets, grossAmount: Number(l.grossAmount), netAmount: Number(l.netAmount), data: ymdDe(l.date)
      });
    } else {
      naoReconhecidas.push({ id: l.id, competencia, status: l.status });
    }
  }
  return { reconhecidas, naoReconhecidas };
}

/** Meses com linha de iFood viva que não é de nenhuma loja do arquivo (diária antiga, nome diferente, status estranho). */
function mesesComLinhaDesconhecida(existentes: Existentes, lojas: LojaIfoodMes[]): Set<string> {
  const meses = new Set(lojas.map((l) => l.competencia));
  return new Set(existentes.naoReconhecidas.filter((n) => meses.has(n.competencia)).map((n) => n.competencia));
}

// ── Trava de período ────────────────────────────────────────────────────────

/** Meses em que alguma data tocada (a nova da linha mensal ou a antiga da linha alterada) cai em período fechado. */
async function mesesTravadosDe(lojas: LojaIfoodMes[], reconhecidas: Existentes["reconhecidas"]): Promise<Set<string>> {
  const datas = new Map<string, Set<string>>();
  for (const l of lojas) {
    const set = datas.get(l.competencia) ?? new Set<string>();
    set.add(dataDaLinhaMensal(l.competencia));
    datas.set(l.competencia, set);
  }
  // Só a data antiga das linhas que SERÃO alteradas conta: linha de outra loja não é tocada.
  const lojasDoArquivo = new Set(lojas.map((l) => `${l.competencia}|${l.lojaIdCurto}`));
  for (const r of reconhecidas) if (lojasDoArquivo.has(`${r.competencia}|${r.loja}`)) datas.get(r.competencia)?.add(r.data);

  const travados = new Set<string>();
  for (const [competencia, conjunto] of datas) {
    for (const data of conjunto) {
      try {
        await assertPeriodWritableForDate(dataUtc(data), "Importação do iFood");
      } catch (error) {
        if (!isPeriodLockedError(error)) throw error;
        travados.add(competencia);
      }
    }
  }
  return travados;
}

// ── Repasses ────────────────────────────────────────────────────────────────

const idDoRepasse = (lojaIdCurto: string, semana: SemanaDeRepasse) => `portal-${lojaIdCurto}-${semana.inicio.replace(/-/g, "")}`;

/** Semana que cruza a virada do mês tem lançamentos nos dois arquivos: o valor de um só seria parcial. */
const semanaDentroDoMes = (s: SemanaDeRepasse, competencia: string) => s.inicio.slice(0, 7) === competencia && s.fim.slice(0, 7) === competencia;
/** Semana ainda em curso tem valor provisório: gravá-la o congelaria, porque o que já existe não é atualizado. */
const semanaEncerrada = (s: SemanaDeRepasse, hoje: string) => s.fim < hoje;

async function repassesNovosDe(db: Banco, loja: LojaCadastrada | null, lojaMes: LojaIfoodMes): Promise<SemanaDeRepasse[]> {
  const hoje = hojeYmd();
  const gravaveis = lojaMes.repasses.filter((s) => semanaDentroDoMes(s, lojaMes.competencia) && semanaEncerrada(s, hoje));
  if (!loja || gravaveis.length === 0) return [];
  const ids = gravaveis.map((s) => idDoRepasse(lojaMes.lojaIdCurto, s));
  const ja = await db.ifoodSettlement.findMany({ where: { deliveryStoreId: loja.id, externalId: { in: ids } }, select: { externalId: true } });
  const existentes = new Set(ja.map((j) => j.externalId));
  return gravaveis.filter((s) => !existentes.has(idDoRepasse(lojaMes.lojaIdCurto, s)));
}

// ── Prévia ──────────────────────────────────────────────────────────────────

/** Queda de pedidos ou de líquido ao alterar: costuma ser arquivo antigo ou parcial sobrescrevendo um completo. */
function houveQueda(i: ItemDoPlanoIfood): boolean {
  const ant = i.anterior;
  return i.acao === "ALTERAR" && ant !== null && (i.loja.pedidos < ant.pedidos || i.loja.liquido < ant.liquido - 0.005);
}

type ItemComSituacao = ItemPrevisto & { desconhecida: boolean };

function avisosEAlertas(itens: ItemComSituacao[], jaExistentes: Set<string>): { avisos: string[]; alertas: string[] } {
  const nome = (i: ItemPrevisto) => `${i.nomeDaLoja ?? `Loja ${i.loja.lojaIdCurto}`} (${i.loja.competencia})`;
  const avisos: string[] = [];
  const alertas: string[] = [];
  const hoje = hojeYmd();
  for (const i of itens) {
    if (!i.nomeDaLoja) avisos.push(`${nome(i)}: a loja não está cadastrada em Integrações Delivery; não será gravada.`);
    if (i.loja.saldoAnterior !== 0) avisos.push(`${nome(i)}: há saldo devedor de períodos anteriores; ele fica fora do líquido.`);
    if (i.repassesNovos > 0) avisos.push(`${nome(i)}: ${i.repassesNovos} repasse(s) novo(s) entram como "em aberto", porque o arquivo não diz se a semana foi paga. Confira o status no portal.`);
    const cortadas = i.loja.repasses.filter((s) => !semanaDentroDoMes(s, i.loja.competencia)).length;
    if (cortadas > 0) avisos.push(`${nome(i)}: ${cortadas} semana(s) de repasse cruzam a virada do mês e não são gravadas.`);
    const emCurso = i.loja.repasses.filter((s) => semanaDentroDoMes(s, i.loja.competencia) && !semanaEncerrada(s, hoje)).length;
    if (emCurso > 0) avisos.push(`${nome(i)}: ${emCurso} semana(s) de repasse ainda em curso não são gravadas; importe de novo depois que fecharem.`);
    if (jaExistentes.has(i.id)) alertas.push(`${nome(i)}: já existe uma linha com o mesmo identificador (cancelada ou editada à mão); ela não será alterada. Resolva à mão.`);
    if (i.desconhecida) alertas.push(`${nome(i)}: o mês já tem lançamento(s) de iFood que não consegui associar a nenhuma loja do arquivo (diária antiga, nome diferente ou status incomum). Gravar poderia contar a receita em dobro; nada é gravado nessa loja-mês.`);
    if (houveQueda(i)) {
      alertas.push(`${nome(i)}: o arquivo reduz o valor já gravado (pedidos ${i.anterior!.pedidos} → ${i.loja.pedidos}, líquido ${i.anterior!.liquido} → ${i.loja.liquido}). Confira se é o mês completo.`);
    }
  }
  return { avisos, alertas };
}

async function idsExistentesDe(db: Banco, plano: ItemDoPlanoIfood[]): Promise<Set<string>> {
  const ids = plano.filter((i) => i.acao === "CRIAR").map((i) => i.id);
  if (ids.length === 0) return new Set();
  const linhas = await db.revenueEntry.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(linhas.map((l) => l.id));
}

type Montagem = { previsao: PrevisaoIfood; resolver: ResolverLoja; novos: Map<string, SemanaDeRepasse[]> };

function contar(totais: PrevisaoIfood["totais"], item: ItemPrevisto, cadastrada: boolean, travado: boolean): void {
  if (!cadastrada) totais.semLoja += 1;
  else if (travado && item.acao !== "IGUAL") totais.travado += 1;
  else if (item.acao === "CRIAR") totais.criar += 1;
  else if (item.acao === "ALTERAR") totais.alterar += 1;
  else if (item.acao === "IGUAL") totais.igual += 1;
  else totais.conflito += 1;
}

async function montarPrevisao(
  db: Banco, nome: string, lojasDoArquivo: LojaIfoodMes[], erros: string[], avisosDoArquivo: string[], alertasDoArquivo: string[]
): Promise<Montagem> {
  const cadastradas = await lerLojas(db);
  const resolver = criarResolvedor(cadastradas, await vinculosPelasLinhasAntigas(db, lojasDoArquivo, cadastradas));
  const existentes = await lerExistentes(db, lojasDoArquivo, cadastradas, resolver);
  const planoBruto = planejarLinhasIfood(lojasDoArquivo, existentes.reconhecidas);
  const jaExistem = await idsExistentesDe(db, planoBruto);
  const comDesconhecida = mesesComLinhaDesconhecida(existentes, lojasDoArquivo);
  const travados = await mesesTravadosDe(lojasDoArquivo, existentes.reconhecidas);
  const totais = { criar: 0, alterar: 0, igual: 0, conflito: 0, travado: 0, semLoja: 0 };
  const novos = new Map<string, SemanaDeRepasse[]>();
  const itens: ItemComSituacao[] = [];

  for (const base of planoBruto) {
    const desconhecida = base.acao === "CRIAR" && comDesconhecida.has(base.loja.competencia);
    const idOcupado = base.acao === "CRIAR" && jaExistem.has(base.id);
    const item: ItemDoPlanoIfood = desconhecida || idOcupado ? { ...base, acao: "CONFLITO" } : base;
    const cadastrada = resolver(item.loja);
    const travado = travados.has(item.loja.competencia);
    // Repasse só é gravado onde a linha da loja pode ser tocada: o que a tela mostra é o que acontece.
    const repasses = cadastrada && !travado && item.acao !== "CONFLITO" ? await repassesNovosDe(db, cadastrada, item.loja) : [];
    novos.set(`${item.loja.competencia}|${item.loja.lojaIdCurto}`, repasses);
    const previsto: ItemPrevisto = { ...item, nomeDaLoja: cadastrada?.nickname ?? null, repassesNovos: repasses.length };
    itens.push({ ...previsto, desconhecida });
    contar(totais, previsto, cadastrada !== null, travado);
  }

  const { avisos, alertas } = avisosEAlertas(itens, jaExistem);
  return {
    previsao: {
      arquivo: nome, erros, avisos: [...avisosDoArquivo, ...avisos], alertas: [...alertasDoArquivo, ...alertas],
      plano: itens.map(({ desconhecida: _desconhecida, ...resto }) => resto), mesesTravados: [...travados].sort(), totais
    },
    resolver,
    novos
  };
}

export async function preverImportacaoIfood(buffer: Buffer, nome: string): Promise<PrevisaoIfood> {
  const { lojas, erros, avisos, alertas } = lerConciliacaoIfood(await lerArquivo(buffer, nome));
  return (await montarPrevisao(prisma, nome, lojas, erros, avisos, alertas)).previsao;
}

// ── Gravação ────────────────────────────────────────────────────────────────

type Anterior = { id: string; gross: number; net: number; orders: number };

async function gravarLinhaMensal(tx: Prisma.TransactionClient, item: ItemPrevisto, cadastrada: LojaCadastrada, anteriores: Anterior[]): Promise<boolean> {
  const { loja } = item;
  const valores = {
    date: dataUtc(dataDaLinhaMensal(loja.competencia)),
    grossAmount: loja.bruto,
    discounts: 0,
    platformFees: Math.round((loja.bruto - loja.liquido) * 100) / 100,
    netAmount: loja.liquido,
    tickets: loja.pedidos,
    ticketAverage: loja.pedidos > 0 ? Math.round((loja.bruto / loja.pedidos) * 10000) / 10000 : null
  };
  if (item.acao === "ALTERAR" && item.existenteId) {
    const antes = await tx.revenueEntry.findUnique({ where: { id: item.existenteId }, select: { grossAmount: true, netAmount: true, tickets: true } });
    // Só atualiza lançamento que continua ATIVO: nunca ressuscita um cancelado.
    const { count } = await tx.revenueEntry.updateMany({ where: { id: item.existenteId, status: "ACTIVE" }, data: valores });
    if (count === 0) return false;
    if (antes) anteriores.push({ id: item.existenteId, gross: Number(antes.grossAmount), net: Number(antes.netAmount), orders: antes.tickets });
    return true;
  }
  // CRIAR: o plano já garantiu que o id não existe em nenhum estado; `create` falha em vez de sobrescrever.
  await tx.revenueEntry.create({
    data: {
      id: item.id,
      ...valores,
      competenceYear: Number(loja.competencia.slice(0, 4)),
      competenceMonth: Number(loja.competencia.slice(5, 7)),
      channel: "Delivery",
      sourcePlatform: SOURCE_PLATFORM,
      description: `Delivery iFood - ${cadastrada.nickname} (consolidado do mes)`,
      status: "ACTIVE"
    }
  });
  return true;
}

async function gravarRepasse(tx: Prisma.TransactionClient, cadastrada: LojaCadastrada, lojaIdCurto: string, competencia: string, semana: SemanaDeRepasse): Promise<void> {
  await tx.ifoodSettlement.create({
    data: {
      deliveryStoreId: cadastrada.id,
      externalId: idDoRepasse(lojaIdCurto, semana),
      periodStart: dataUtc(semana.inicio),
      periodEnd: dataUtc(semana.fim),
      grossAmount: semana.valor,
      totalFees: 0,
      netAmount: semana.valor,
      paidAt: null,
      status: semana.valor < 0 ? "SALDO_PENDENTE" : "EM_ABERTO",
      // O arquivo não informa se a semana foi paga: o status é provisório e a origem fica registrada.
      rawPayload: { origem: "conciliacao-portal", statusConfirmado: false, previsao: semana.previsao, competencia }
    }
  });
}

export async function confirmarImportacaoIfood(
  buffer: Buffer,
  nome: string,
  contexto: { userId: string | null; ipAddress?: string | null; userAgent?: string | null; confirmouAlertas?: boolean }
): Promise<ResultadoIfood> {
  const { lojas, erros, avisos, alertas } = lerConciliacaoIfood(await lerArquivo(buffer, nome));
  if (erros.length > 0) throw new ErroDeImportacao("O arquivo tem lançamentos com erro. Corrija e envie de novo.");

  const anteriores: Anterior[] = [];
  const gravadas: string[] = [];

  const { previsao, gravados, repassesGravados } = await prisma.$transaction(
    async (tx) => {
      // A prévia da tela não é confiável: com o lock tomado, o plano é refeito contra o estado atual.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_DO_LOCK}))`;
      const { previsao: atual, resolver, novos } = await montarPrevisao(tx, nome, lojas, erros, avisos, alertas);
      if (atual.alertas.length > 0 && !contexto.confirmouAlertas) {
        throw new ErroDeImportacao("Há alertas na prévia. Leia e marque a confirmação antes de gravar.");
      }
      const travados = new Set(atual.mesesTravados);
      let feitos = 0;
      let repasses = 0;

      for (const item of atual.plano) {
        const cadastrada = resolver(item.loja);
        if (!cadastrada || travados.has(item.loja.competencia) || item.acao === "CONFLITO") continue;
        const { loja } = item;
        if (item.acao === "CRIAR" || item.acao === "ALTERAR") {
          if (!(await gravarLinhaMensal(tx, item, cadastrada, anteriores))) continue;
          feitos += 1;
          gravadas.push(`${cadastrada.nickname} ${loja.competencia.slice(5, 7)}/${loja.competencia.slice(0, 4)}`);
        }
        // Repasses só entram quando a semana ainda não existe: o que já foi conferido não é tocado.
        for (const semana of novos.get(`${loja.competencia}|${loja.lojaIdCurto}`) ?? []) {
          await gravarRepasse(tx, cadastrada, loja.lojaIdCurto, loja.competencia, semana);
          repasses += 1;
        }
      }
      return { previsao: atual, gravados: feitos, repassesGravados: repasses };
    },
    { timeout: TIMEOUT_DA_GRAVACAO_MS }
  );

  // Os dados já estão gravados: falha na trilha de auditoria é registrada, mas não vira erro para o usuário.
  await auditLog({
    userId: contexto.userId,
    action: AUDIT_ACTION,
    entity: "RevenueEntry",
    entityId: null,
    previousValue: { arquivo: nome.slice(0, NOME_MAXIMO_NA_AUDITORIA), anteriores },
    newValue: { gravados, repassesGravados, gravadas, totais: previsao.totais, alertasConfirmados: previsao.alertas, mesesTravados: previsao.mesesTravados },
    ipAddress: contexto.ipAddress ?? null,
    userAgent: contexto.userAgent ?? null
  }).catch((error: unknown) => console.error("[iFood] falha ao gravar a auditoria da importação:", error));

  return { ...previsao, gravados, repassesGravados, gravadas };
}
