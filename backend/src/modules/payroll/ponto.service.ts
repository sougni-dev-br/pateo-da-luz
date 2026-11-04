import type { Prisma, PontoFechamento, PontoOrigem } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForRange } from "../cmv-real/cmv-real.service.js";
import { agruparBatidasPorDia, lerAfd671 } from "./afd-parser.js";
import { holidaysForYear } from "./holidays.js";
import type { ResumoFechamento } from "./ponto-banco.js";
import { decidirFolgaBanco, jornadaDaPessoa, rotuloTurno, type TipoDiaEscala } from "./ponto-jornada.js";
import { apurarMesPessoa, diasDoMes, type MesPessoa } from "./ponto-mes.js";
import { chaveTravaMes, foiGravadoPeloPonto, notaDoPonto, tipoAnteriorDoPonto, travarMeses } from "./ponto-trava.js";

export class PontoRecusa extends Error {
  constructor(readonly status: number, message: string, readonly codigo?: string) {
    super(message);
  }
}

const MAX_BATIDAS_DIA = 8;
const HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;
export const LIMITE_MARCACOES_AFD = 60_000;
const TAMANHO_LOTE = 200;
const PRIMEIRO_DIA_ACEITO = "2020-01-01";
const DIA_MS = 86_400_000;

const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const diaDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const nomeDe = (e: { firstName: string; lastName: string; displayName: string | null }) =>
  e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();
const soDigitos = (s: string) => s.replace(/\D/g, "");
const mesTexto = (year: number, month: number) => `${String(month).padStart(2, "0")}/${year}`;
const hojeSaoPaulo = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

type Tx = Prisma.TransactionClient;
type Cliente = typeof prisma | Tx;

export function parseMes(year: unknown, month: unknown): { year: number; month: number } {
  const bruto = [year, month].map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : ""));
  const [y, m] = bruto.map((v) => (/^\d{1,4}$/.test(v) ? Number(v) : NaN));
  if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new PontoRecusa(400, "Mês inválido.");
  }
  return { year: y, month: m };
}

export function normalizarMarcacoes(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new PontoRecusa(400, "Informe as batidas do dia.");
  if (raw.length > MAX_BATIDAS_DIA) throw new PontoRecusa(400, `No máximo ${MAX_BATIDAS_DIA} batidas por dia.`);
  const batidas = raw.map((h) => String(h).trim());
  const ruim = batidas.find((h) => !HORA.test(h));
  if (ruim !== undefined) throw new PontoRecusa(400, `Horário inválido: "${ruim}" (use HH:mm).`);
  const padrao = batidas.map((h) => h.padStart(5, "0"));
  if (padrao.some((h, i) => i > 0 && h === padrao[i - 1])) throw new PontoRecusa(400, "Há duas batidas iguais em sequência.");
  return padrao;
}

/** AAAA-MM-DD que existe de verdade (31/02 e 2026-13-45 não passam). */
export function dataValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const d = diaDate(data);
  return !Number.isNaN(d.getTime()) && isoDia(d) === data;
}

// ─── Escala vista pelo Ponto ────────────────────────────────────────────────────

// Férias lançadas na Folha (não na Escala) também são dia sem trabalho: a gorjeta, o VT e a grade da Escala já leem assim.
async function diasDeFeriasDaFolha(cliente: Cliente, ids: string[], inicio: Date, fim: Date): Promise<Set<string>> {
  const dias = new Set<string>();
  if (ids.length === 0) return dias;
  const itens = await cliente.payrollItem.findMany({
    where: { type: "FERIAS", deletedAt: null, employeeId: { in: ids }, periodStart: { lte: fim }, periodEnd: { gte: inicio } },
    select: { employeeId: true, periodStart: true, periodEnd: true },
  });
  for (const f of itens) {
    if (!f.periodStart || !f.periodEnd) continue;
    const de = Math.max(inicio.getTime(), f.periodStart.getTime());
    const ate = Math.min(fim.getTime(), f.periodEnd.getTime());
    for (let t = de; t <= ate; t += DIA_MS) dias.add(`${f.employeeId}|${isoDia(new Date(t))}`);
  }
  return dias;
}

const TIPOS_QUE_FERIAS_NAO_SUBSTITUEM: ReadonlySet<string> = new Set(["AFASTAMENTO", "FERIAS"]);

// Tipo do dia como o Ponto precisa enxergar: a marca da Escala, com as férias da Folha valendo sobre turno, evento, falta ou folga.
function escalaEfetiva(employeeId: string, marcas: Array<{ date: Date; type: string }>, ferias: Set<string>): Map<string, TipoDiaEscala> {
  const mapa = new Map<string, TipoDiaEscala>(marcas.map((m) => [isoDia(m.date), m.type as TipoDiaEscala]));
  for (const chave of ferias) {
    const [id, dia] = chave.split("|");
    if (id === employeeId && !TIPOS_QUE_FERIAS_NAO_SUBSTITUEM.has(mapa.get(dia) ?? "")) mapa.set(dia, "FERIAS");
  }
  return mapa;
}

// A Escala só considera o mês montado se alguém marcou o dia; o que o próprio Ponto gravou (falta, folga do banco) não conta.
const mesMontadoPorMarcasDaEscala = (marcas: Array<{ notes: string | null }>) => marcas.some((m) => !foiGravadoPeloPonto(m.notes));

// ─── Lançamento do papel ────────────────────────────────────────────────────────

// Funcionário existente e com vínculo no dia (nem antes da admissão, nem depois do desligamento).
async function funcionarioNoDia(employeeId: string, data: string) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: { id: true, admissionDate: true, terminationDate: true },
  });
  if (!emp) throw new PontoRecusa(404, "Funcionário não encontrado.");
  if (emp.admissionDate && data < isoDia(emp.admissionDate)) throw new PontoRecusa(400, "Esse dia é anterior à admissão da pessoa.");
  if (emp.terminationDate && data > isoDia(emp.terminationDate)) throw new PontoRecusa(400, "Esse dia é posterior ao desligamento da pessoa.");
  return emp;
}

// Chegou batida para um dia que o Ponto tinha marcado como falta: a falta deixa de valer e o dia volta ao que era.
async function desfazerFaltaDoPonto(tx: Tx, employeeId: string, date: Date): Promise<boolean> {
  const chave = { employeeId_date: { employeeId, date } };
  const marca = await tx.employeeScheduleDay.findUnique({ where: chave, select: { type: true, notes: true } });
  if (marca?.type !== "FALTA" || !foiGravadoPeloPonto(marca.notes)) return false;
  const antes = tipoAnteriorDoPonto(marca.notes);
  if (antes === "TURNO" || antes === "EVENTO") await tx.employeeScheduleDay.update({ where: chave, data: { type: antes, notes: null } });
  else await tx.employeeScheduleDay.delete({ where: chave });
  return true;
}

export interface DiaSalvo {
  employeeId: string;
  date: string;
  marcacoes: string[];
  /** O que estava gravado antes (null = não havia lançamento), para a auditoria. */
  anterior: string[] | null;
  /** A falta que o Ponto tinha lançado na Escala para este dia foi desfeita porque chegou batida. */
  faltaDesfeita: boolean;
}

export async function lancarDia(p: { employeeId: string; date: string; marcacoes: unknown; notes?: unknown; userId: string }): Promise<DiaSalvo> {
  if (!dataValida(p.date)) throw new PontoRecusa(400, "Data inválida.");
  if (p.date > hojeSaoPaulo()) throw new PontoRecusa(400, "Não dá para lançar ponto de um dia que ainda não chegou.");
  const marcacoes = normalizarMarcacoes(p.marcacoes);
  const emp = await funcionarioNoDia(p.employeeId, p.date);

  const [year, month] = [Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7))];
  const date = diaDate(p.date);
  // Anotação só muda se vier no pedido: salvar os horários não apaga o que já estava escrito.
  const notas = typeof p.notes === "string" ? { notes: p.notes.trim() ? p.notes.trim().slice(0, 300) : null } : {};

  return prisma.$transaction(async (tx) => {
    await travarMeses(tx, [chaveTravaMes(year, month)]);
    const fechamento = await tx.pontoFechamento.findUnique({ where: { employeeId_year_month: { employeeId: emp.id, year, month } } });
    if (fechamento?.status === "FECHADO") throw new PontoRecusa(409, "O ponto deste mês já está fechado. Reabra para corrigir.");

    let faltaDesfeita = false;
    if (marcacoes.length > 0) {
      const escala = await tx.employeeScheduleDay.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } }, select: { type: true } });
      if (escala?.type === "FOLGA_BANCO_HORAS") throw new PontoRecusa(409, "Esse dia é folga do banco de horas. Desfaça a folga para lançar batidas.");
      faltaDesfeita = await desfazerFaltaDoPonto(tx, emp.id, date);
    }
    const atual = await tx.pontoDia.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } });
    const anterior = atual ? atual.marcacoes : null;
    if (marcacoes.length === 0 && !atual) return { employeeId: emp.id, date: p.date, marcacoes, anterior, faltaDesfeita };

    // Dia apagado fica gravado vazio e como manual: a próxima importação do relógio não o ressuscita.
    const dados = { origem: "PAPEL" as PontoOrigem, marcacoes, editadoManual: true };
    await tx.pontoDia.upsert({
      where: { employeeId_date: { employeeId: emp.id, date } },
      create: { employeeId: emp.id, date, createdById: p.userId, notes: null, ...dados, ...notas },
      update: { ...dados, ...notas },
    });
    return { employeeId: emp.id, date: p.date, marcacoes, anterior, faltaDesfeita };
  });
}

// ─── Importação do relógio (AFD) ────────────────────────────────────────────────

export interface ResultadoImportacao {
  pessoas: number;
  diasGravados: number;
  diasIguais: number;
  conflitos: number; // dia com lançamento manual ou de papel: o relógio não sobrescreve
  mesesFechados: number;
  /** Dias fora do que o papel aceitaria: futuros, antes da admissão, depois do desligamento ou em folga do banco. */
  diasIgnorados: number;
  cpfsSemCadastro: number;
  de: string | null;
  ate: string | null;
  avisos: string[];
}

interface DiaPlanejado {
  employeeId: string;
  data: string;
  marcacoes: string[];
}

export async function importarAfd(texto: string, userId: string): Promise<ResultadoImportacao> {
  const { batidas, avisos } = lerAfd671(texto);
  if (batidas.length > LIMITE_MARCACOES_AFD) {
    throw new PontoRecusa(413, `O arquivo tem mais de ${LIMITE_MARCACOES_AFD} marcações. Exporte um período menor.`);
  }
  const resultado: ResultadoImportacao = { pessoas: 0, diasGravados: 0, diasIguais: 0, conflitos: 0, mesesFechados: 0, diasIgnorados: 0, cpfsSemCadastro: 0, de: null, ate: null, avisos };
  if (batidas.length === 0) return resultado;

  const funcionarios = await prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, cpf: true, admissionDate: true, terminationDate: true } });
  const idPorCpf = new Map(funcionarios.map((f) => [soDigitos(f.cpf), f.id]));
  const vinculoPorId = new Map(funcionarios.map((f) => [f.id, { admissao: f.admissionDate ? isoDia(f.admissionDate) : null, desligamento: f.terminationDate ? isoDia(f.terminationDate) : null }]));
  const hoje = hojeSaoPaulo();

  const planejados: DiaPlanejado[] = [];
  let terminamSemPar = 0;
  for (const [cpf, dias] of agruparBatidasPorDia(batidas)) {
    const employeeId = idPorCpf.get(cpf);
    if (!employeeId) {
      resultado.cpfsSemCadastro += 1;
      continue;
    }
    resultado.pessoas += 1;
    const vinculo = vinculoPorId.get(employeeId);
    for (const d of dias) {
      const foraDoAceito = d.data < PRIMEIRO_DIA_ACEITO || d.data > hoje || (vinculo?.admissao && d.data < vinculo.admissao) || (vinculo?.desligamento && d.data > vinculo.desligamento);
      if (foraDoAceito) resultado.diasIgnorados += 1;
      else planejados.push({ employeeId, data: d.data, marcacoes: d.marcacoes });
    }
    if (dias.length > 0 && dias[dias.length - 1].marcacoes.length % 2 === 1) terminamSemPar += 1;
  }
  if (terminamSemPar > 0) {
    avisos.push(`${terminamSemPar} ${terminamSemPar === 1 ? "pessoa termina" : "pessoas terminam"} o arquivo com uma batida sem par: o turno pode continuar no período seguinte.`);
  }
  if (resultado.diasIgnorados > 0) avisos.push(`${resultado.diasIgnorados} ${resultado.diasIgnorados === 1 ? "dia ignorado" : "dias ignorados"}: data futura, antes da admissão ou depois do desligamento.`);
  if (planejados.length === 0) return resultado;

  const datas = planejados.map((d) => d.data).sort();
  [resultado.de, resultado.ate] = [datas[0], datas[datas.length - 1]];
  const ids = [...new Set(planejados.map((d) => d.employeeId))];
  const existentes = await prisma.pontoDia.findMany({
    where: { employeeId: { in: ids }, date: { gte: diaDate(datas[0]), lte: diaDate(datas[datas.length - 1]) } },
  });
  const existentePorDia = new Map(existentes.map((e) => [`${e.employeeId}|${isoDia(e.date)}`, e]));

  const gravar: DiaPlanejado[] = [];
  for (const dia of planejados) {
    const atual = existentePorDia.get(`${dia.employeeId}|${dia.data}`);
    if (atual && (atual.editadoManual || atual.origem === "PAPEL")) resultado.conflitos += 1;
    else if (atual && atual.marcacoes.join(",") === dia.marcacoes.join(",")) resultado.diasIguais += 1;
    else gravar.push(dia);
  }

  for (let i = 0; i < gravar.length; i += TAMANHO_LOTE) {
    const lote = await gravarLoteDoRelogio(gravar.slice(i, i + TAMANHO_LOTE), userId);
    resultado.diasGravados += lote.gravados;
    resultado.conflitos += lote.conflitos;
    resultado.diasIgnorados += lote.ignorados;
    resultado.mesesFechados += lote.mesesFechados;
    resultado.diasIguais += lote.iguais;
  }
  return resultado;
}

// Um lote por transação, com o mês travado e TUDO refeito já dentro da trava: fechamento, lançamento manual e folga do banco.
async function gravarLoteDoRelogio(lote: DiaPlanejado[], userId: string) {
  const mesesDoLote = [...new Set(lote.map((d) => d.data.slice(0, 7)))].map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) }));
  return prisma.$transaction(async (tx) => {
    await travarMeses(tx, mesesDoLote.map((m) => chaveTravaMes(m.year, m.month)));
    const fechados = await tx.pontoFechamento.findMany({
      where: { status: "FECHADO", employeeId: { in: [...new Set(lote.map((d) => d.employeeId))] }, OR: mesesDoLote },
      select: { employeeId: true, year: true, month: true },
    });
    const fechadoSet = new Set(fechados.map((f) => `${f.employeeId}|${f.year}|${f.month}`));
    const livres = lote.filter((d) => !fechadoSet.has(`${d.employeeId}|${Number(d.data.slice(0, 4))}|${Number(d.data.slice(5, 7))}`));
    const contagem = { gravados: 0, conflitos: 0, ignorados: 0, iguais: 0, mesesFechados: lote.length - livres.length };
    if (livres.length === 0) return contagem;

    const chaves = livres.map((d) => ({ employeeId: d.employeeId, date: diaDate(d.data) }));
    const [existentes, escala] = await Promise.all([
      tx.pontoDia.findMany({ where: { OR: chaves } }),
      tx.employeeScheduleDay.findMany({ where: { OR: chaves }, select: { employeeId: true, date: true, type: true } }),
    ]);
    const existentePor = new Map(existentes.map((e) => [`${e.employeeId}|${isoDia(e.date)}`, e]));
    const tipoPor = new Map(escala.map((e) => [`${e.employeeId}|${isoDia(e.date)}`, e.type]));

    for (const d of livres) {
      const chave = `${d.employeeId}|${d.data}`;
      const atual = existentePor.get(chave);
      if (atual && (atual.editadoManual || atual.origem === "PAPEL")) {
        contagem.conflitos += 1; // alguém corrigiu à mão depois da leitura: a correção vale
        continue;
      }
      if (tipoPor.get(chave) === "FOLGA_BANCO_HORAS") {
        contagem.ignorados += 1; // o papel também recusa batida em folga do banco
        continue;
      }
      if (atual && atual.marcacoes.join(",") === d.marcacoes.join(",")) {
        contagem.iguais += 1;
        continue;
      }
      const date = diaDate(d.data);
      await tx.pontoDia.upsert({
        where: { employeeId_date: { employeeId: d.employeeId, date } },
        create: { employeeId: d.employeeId, date, origem: "RELOGIO", marcacoes: d.marcacoes, createdById: userId },
        update: { marcacoes: d.marcacoes },
      });
      await desfazerFaltaDoPonto(tx, d.employeeId, date);
      contagem.gravados += 1;
    }
    return contagem;
  }, { timeout: 60_000, maxWait: 10_000 });
}

// ─── Apuração e fechamento do mês ───────────────────────────────────────────────

export interface LinhaFechamento extends MesPessoa {
  employeeId: string;
  nome: string;
  status: "ABERTO" | "FECHADO";
  saldoAnteriorConfirmado: boolean;
  saldoInicialMin: number;
  /** Turno usado na conta ("08:00–17:00") e de onde veio: da Escala ou, na falta, do contrato. */
  turno: string | null;
  turnoFonte: "escala" | "contrato";
}

// Mês fechado mostra o que foi guardado no fechamento, não uma conta nova: o número que a folha
// pagou não muda se alguém mexer depois na jornada ou na escala.
function resumoGuardado(f: PontoFechamento, diasComAviso: number, diasPendentes: number): ResumoFechamento {
  return {
    faltas: f.faltas,
    noturnoMin: f.noturnoMin,
    extraDescansoMin: f.extraDescansoMin,
    atrasoMin: f.atrasoMin,
    abatidoMin: f.abatidoMin,
    extraAPagarMin: f.extraAPagarMin,
    saldoBancoFinalMin: f.saldoFinalMin,
    devendo: f.saldoFinalMin < 0,
    diasComAviso,
    diasPendentes,
  };
}

const porPessoa = <T extends { employeeId: string }>(linhas: T[]): Map<string, T[]> => {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) mapa.set(l.employeeId, [...(mapa.get(l.employeeId) ?? []), l]);
  return mapa;
};

export async function apurarMes(year: number, month: number, cliente: Cliente = prisma): Promise<LinhaFechamento[]> {
  const dias = diasDoMes(year, month);
  const [inicio, fim] = [diaDate(dias[0]), diaDate(dias[dias.length - 1])];
  const anterior = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const feriados = new Set(holidaysForYear(year).keys());
  const hoje = hojeSaoPaulo();

  const funcionarios = await cliente.employee.findMany({
    where: {
      deletedAt: null,
      registraPonto: true, // quem não bate ponto (ex.: 5x2 fixo) fica fora da apuração
      OR: [{ terminationDate: null }, { terminationDate: { gte: inicio } }],
      AND: [{ OR: [{ admissionDate: null }, { admissionDate: { lte: fim } }] }],
    },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, admissionDate: true, terminationDate: true,
      jornadaInicio: true, jornadaFim: true, intervaloInicio: true, intervaloFim: true,
      shiftStart: true, shiftEnd: true, includeInSchedule: true,
    },
  });
  const ids = funcionarios.map((f) => f.id);
  const [pontos, escala, ferias, anteriores, atuais] = await Promise.all([
    cliente.pontoDia.findMany({ where: { employeeId: { in: ids }, date: { gte: inicio, lte: fim } } }),
    cliente.employeeScheduleDay.findMany({ where: { employeeId: { in: ids }, date: { gte: inicio, lte: fim } }, select: { employeeId: true, date: true, type: true, notes: true } }),
    diasDeFeriasDaFolha(cliente, ids, inicio, fim),
    cliente.pontoFechamento.findMany({ where: { employeeId: { in: ids }, ...anterior, status: "FECHADO" } }),
    cliente.pontoFechamento.findMany({ where: { employeeId: { in: ids }, year, month } }),
  ]);
  const pontosDe = porPessoa(pontos);
  const escalaDe = porPessoa(escala);
  const anteriorDe = new Map(anteriores.map((a) => [a.employeeId, a]));
  const atualDe = new Map(atuais.map((a) => [a.employeeId, a]));

  const linhas: LinhaFechamento[] = [];
  for (const f of funcionarios) {
    const batidasPorDia = new Map((pontosDe.get(f.id) ?? []).map((p) => [isoDia(p.date), p.marcacoes]));
    const { jornada, fonte } = jornadaDaPessoa(f);
    const turno = rotuloTurno(jornada);
    // Entra quem monta escala e tem turno, e quem tem batida. Fora disso, sem turno e sem batida, não há o que apurar.
    if (batidasPorDia.size === 0 && !(f.includeInSchedule && turno)) continue;
    const marcas = escalaDe.get(f.id) ?? [];
    const saldoAnterior = anteriorDe.get(f.id);
    const mes = apurarMesPessoa({
      year, month,
      jornada,
      naEscala: f.includeInSchedule,
      escalaMontada: mesMontadoPorMarcasDaEscala(marcas),
      batidasPorDia,
      escalaPorDia: escalaEfetiva(f.id, marcas, ferias),
      feriados,
      admissao: f.admissionDate ? isoDia(f.admissionDate) : null,
      desligamento: f.terminationDate ? isoDia(f.terminationDate) : null,
      saldoInicialMin: saldoAnterior?.saldoFinalMin ?? 0,
      ate: hoje,
    });
    const fechamento = atualDe.get(f.id);
    const guardado = fechamento?.status === "FECHADO" ? fechamento : null;
    linhas.push({
      ...mes,
      resumo: guardado ? resumoGuardado(guardado, mes.resumo.diasComAviso, mes.resumo.diasPendentes) : mes.resumo,
      debitoFolgaMin: guardado ? guardado.debitoFolgaMin : mes.debitoFolgaMin,
      employeeId: f.id,
      nome: nomeDe(f),
      status: fechamento?.status ?? "ABERTO",
      saldoAnteriorConfirmado: Boolean(saldoAnterior),
      saldoInicialMin: guardado ? guardado.saldoInicialMin : (saldoAnterior?.saldoFinalMin ?? 0),
      turno,
      turnoFonte: fonte,
    });
  }
  return linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Quem lançou ponto no mês anterior precisa ter esse mês fechado: o saldo do banco encadeia.
async function exigirMesAnteriorFechado(tx: Tx, linhas: LinhaFechamento[], year: number, month: number) {
  const anterior = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const dias = diasDoMes(anterior.year, anterior.month);
  const ids = linhas.map((l) => l.employeeId);
  const [comPonto, fechados] = await Promise.all([
    tx.pontoDia.findMany({ where: { employeeId: { in: ids }, date: { gte: diaDate(dias[0]), lte: diaDate(dias[dias.length - 1]) } }, select: { employeeId: true }, distinct: ["employeeId"] }),
    tx.pontoFechamento.findMany({ where: { employeeId: { in: ids }, ...anterior, status: "FECHADO" }, select: { employeeId: true } }),
  ]);
  const fechadoSet = new Set(fechados.map((f) => f.employeeId));
  const pendentes = comPonto.filter((p) => !fechadoSet.has(p.employeeId)).map((p) => linhas.find((l) => l.employeeId === p.employeeId)?.nome ?? "");
  if (pendentes.length > 0) {
    throw new PontoRecusa(409, `Feche primeiro ${mesTexto(anterior.year, anterior.month)}: o saldo do banco de horas depende dele (${pendentes.slice(0, 5).join(", ")}${pendentes.length > 5 ? "…" : ""}).`);
  }
}

export async function fecharMes(year: number, month: number, userId: string, opcoes: { confirmarAvisos?: boolean } = {}) {
  const ultimoDia = diasDoMes(year, month).at(-1) as string;
  // O último dia ainda pode ter turno aberto (batida de saída por vir): só fecha a partir do dia seguinte.
  if (ultimoDia >= hojeSaoPaulo()) throw new PontoRecusa(409, "O mês ainda não terminou. Feche a partir do dia seguinte ao último dia.");

  return prisma.$transaction(async (tx) => {
    await travarMeses(tx, [chaveTravaMes(year, month)]);
    const linhas = (await apurarMes(year, month, tx)).filter((l) => !l.semJornada && l.status === "ABERTO");
    const semLancamento = linhas.filter((l) => l.semLancamento);
    if (semLancamento.length > 0) {
      throw new PontoRecusa(409, `Falta lançar o ponto de ${semLancamento.length === 1 ? "1 pessoa" : `${semLancamento.length} pessoas`} (${semLancamento.slice(0, 5).map((l) => l.nome).join(", ")}${semLancamento.length > 5 ? "…" : ""}). Lance o papel ou importe o relógio antes de fechar o mês.`);
    }
    await exigirMesAnteriorFechado(tx, linhas, year, month);

    const comAviso = linhas.filter((l) => l.resumo.diasComAviso > 0);
    if (comAviso.length > 0 && !opcoes.confirmarAvisos) {
      throw new PontoRecusa(409, `${comAviso.length} ${comAviso.length === 1 ? "pessoa ainda tem" : "pessoas ainda têm"} dias para conferir (${comAviso.slice(0, 5).map((l) => l.nome).join(", ")}${comAviso.length > 5 ? "…" : ""}).`, "CONFIRMAR_AVISOS");
    }

    const agora = new Date();
    for (const l of linhas) {
      const dados = {
        status: "FECHADO" as const,
        saldoInicialMin: l.saldoInicialMin,
        saldoFinalMin: l.resumo.saldoBancoFinalMin,
        atrasoMin: l.resumo.atrasoMin,
        debitoFolgaMin: l.debitoFolgaMin,
        extraMin: l.periodo.extraMin,
        abatidoMin: l.resumo.abatidoMin,
        extraAPagarMin: l.resumo.extraAPagarMin,
        extraDescansoMin: l.resumo.extraDescansoMin,
        noturnoMin: l.resumo.noturnoMin,
        faltas: l.resumo.faltas,
        closedAt: agora,
        closedById: userId,
      };
      await tx.pontoFechamento.upsert({
        where: { employeeId_year_month: { employeeId: l.employeeId, year, month } },
        create: { employeeId: l.employeeId, year, month, ...dados },
        update: dados,
      });
    }
    return { fechados: linhas.length, comAviso: comAviso.length };
  }, { timeout: 60_000, maxWait: 10_000 });
}

export async function reabrirMes(year: number, month: number) {
  return prisma.$transaction(async (tx) => {
    await travarMeses(tx, [chaveTravaMes(year, month)]);
    const posterior = await tx.pontoFechamento.findFirst({
      where: { status: "FECHADO", OR: [{ year: { gt: year } }, { year, month: { gt: month } }] },
      orderBy: [{ year: "asc" }, { month: "asc" }],
      select: { year: true, month: true },
    });
    if (posterior) {
      throw new PontoRecusa(409, `Reabra primeiro ${mesTexto(posterior.year, posterior.month)}: o saldo do banco de horas dele depende deste mês.`);
    }
    // O fechamento completo vai para a auditoria: o próximo fechar sobrescreve estes números.
    const fechados = await tx.pontoFechamento.findMany({
      where: { year, month, status: "FECHADO" },
      select: {
        employeeId: true, saldoInicialMin: true, saldoFinalMin: true, atrasoMin: true, debitoFolgaMin: true, extraMin: true,
        abatidoMin: true, extraAPagarMin: true, extraDescansoMin: true, noturnoMin: true, faltas: true, closedById: true, closedAt: true,
      },
    });
    await tx.pontoFechamento.updateMany({ where: { year, month, status: "FECHADO" }, data: { status: "ABERTO", closedAt: null, closedById: null } });
    return { reabertos: fechados.length, pessoas: fechados };
  });
}

export async function batidasDoMes(employeeId: string, year: number, month: number) {
  const dias = diasDoMes(year, month);
  const [inicio, fim] = [diaDate(dias[0]), diaDate(dias[dias.length - 1])];
  const intervalo = { gte: inicio, lte: fim };
  const [rows, marcas, ferias, pessoa] = await Promise.all([
    prisma.pontoDia.findMany({ where: { employeeId, date: intervalo } }),
    prisma.employeeScheduleDay.findMany({ where: { employeeId, date: intervalo }, select: { date: true, type: true, notes: true } }),
    diasDeFeriasDaFolha(prisma, [employeeId], inicio, fim),
    prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { shiftStart: true, shiftEnd: true, jornadaInicio: true, jornadaFim: true, intervaloInicio: true, intervaloFim: true, includeInSchedule: true },
    }),
  ]);
  const turno = pessoa ? rotuloTurno(jornadaDaPessoa(pessoa).jornada) : null;
  return {
    // A anotação livre (pode trazer dado de saúde) não sai desta resposta.
    dias: rows.map((r) => ({ date: isoDia(r.date), origem: r.origem, marcacoes: r.marcacoes, editadoManual: r.editadoManual })),
    escala: [...escalaEfetiva(employeeId, marcas, ferias)].map(([date, tipo]) => ({ date, tipo })),
    turno,
    mesMontado: Boolean(pessoa?.includeInSchedule) && mesMontadoPorMarcasDaEscala(marcas),
  };
}

// ─── Folga tirada contra o banco de horas ───────────────────────────────────────

export interface FolgaDoBanco {
  employeeId: string;
  date: string;
  ativo: boolean;
}

export interface FolgaDoBancoGravada extends FolgaDoBanco {
  /** Tipo que o dia tinha na Escala antes (null = sem marca), para a auditoria. */
  anterior: string | null;
}

/**
 * Marca (ou desfaz) uma folga contra o banco de horas. Grava na escala (mesmo tipo que a tela
 * Escala usa), então os dois módulos concordam. Guarda o tipo que o dia tinha para devolvê-lo ao desfazer.
 */
export async function marcarFolgaBanco(p: FolgaDoBanco & { userId: string }): Promise<FolgaDoBancoGravada> {
  if (!dataValida(p.date)) throw new PontoRecusa(400, "Data inválida.");
  const emp = await funcionarioNoDia(p.employeeId, p.date);
  const [year, month] = [Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7))];
  const date = diaDate(p.date);
  const chave = { employeeId_date: { employeeId: emp.id, date } };
  // Mesma trava de período (mês travado, CMV fechado) das outras telas que escrevem na Escala.
  try {
    await assertPeriodWritableForRange(date, date, "Folga do banco de horas");
  } catch (err) {
    throw new PontoRecusa(409, err instanceof Error ? err.message : "Período fechado.");
  }

  return prisma.$transaction(async (tx) => {
    await travarMeses(tx, [chaveTravaMes(year, month)]);
    const fechamento = await tx.pontoFechamento.findUnique({ where: { employeeId_year_month: { employeeId: emp.id, year, month } } });
    if (fechamento?.status === "FECHADO") throw new PontoRecusa(409, "O ponto deste mês já está fechado. Reabra para mudar a folga.");

    const [escala, ponto, ferias] = await Promise.all([
      tx.employeeScheduleDay.findUnique({ where: chave }),
      tx.pontoDia.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } }),
      diasDeFeriasDaFolha(tx, [emp.id], date, date),
    ]);
    const anterior = (escala?.type as string | undefined) ?? null;
    if (p.ativo && ferias.size > 0) throw new PontoRecusa(409, "Esse dia está dentro de férias lançadas na Folha.");
    const decisao = decidirFolgaBanco({ ativo: p.ativo, tipoAtual: (escala?.type as TipoDiaEscala | undefined) ?? null, temBatidas: (ponto?.marcacoes.length ?? 0) > 0 });

    if (decisao.acao === "recusar") throw new PontoRecusa(409, decisao.motivo);
    if (decisao.acao === "marcar") {
      const dados = { type: "FOLGA_BANCO_HORAS" as const, notes: notaDoPonto(decisao.antes) };
      await tx.employeeScheduleDay.upsert({ where: chave, create: { employeeId: emp.id, date, createdById: p.userId, ...dados }, update: dados });
      return { employeeId: emp.id, date: p.date, ativo: true, anterior };
    }
    if (decisao.acao === "desmarcar") {
      const antes = tipoAnteriorDoPonto(escala?.notes);
      if (antes === "TURNO" || antes === "EVENTO") await tx.employeeScheduleDay.update({ where: chave, data: { type: antes, notes: null } });
      else await tx.employeeScheduleDay.delete({ where: chave });
      return { employeeId: emp.id, date: p.date, ativo: false, anterior };
    }
    return { employeeId: emp.id, date: p.date, ativo: escala?.type === "FOLGA_BANCO_HORAS", anterior };
  });
}

// ─── Faltas do Ponto → Escala ────────────────────────────────────────────────────
// A gorjeta, o VT e a folha leem a falta da Escala (tipo FALTA). Dia trabalhado sem batida
// no Ponto vira FALTA lá, para os módulos concordarem com o que o Ponto apurou.

export interface FaltasParaEscala {
  faltas: number;
  pessoas: Array<{ employeeId: string; nome: string; dias: string[] }>;
  /** Cada dia com o tipo que tinha antes na Escala (null = sem marca), para a auditoria. */
  detalhe: Array<{ employeeId: string; data: string; antes: string | null }>;
  gravadas: boolean;
}

const TIPOS_QUE_VIRAM_FALTA: ReadonlySet<string | undefined> = new Set([undefined, "TURNO", "EVENTO"]);

// Tudo é lido e decidido com o cliente recebido: na gravação é a própria transação, já sob a trava do mês.
async function faltasPendentes(cliente: Cliente, year: number, month: number): Promise<Omit<FaltasParaEscala, "gravadas">> {
  const dias = diasDoMes(year, month);
  const [inicio, fim] = [diaDate(dias[0]), diaDate(dias[dias.length - 1])];
  const hoje = hojeSaoPaulo();

  const linhas = (await apurarMes(year, month, cliente)).filter((l) => !l.semJornada && !l.semLancamento && l.status === "ABERTO");
  const marcas = await cliente.employeeScheduleDay.findMany({
    where: { employeeId: { in: linhas.map((l) => l.employeeId) }, date: { gte: inicio, lte: fim } },
    select: { employeeId: true, date: true, type: true },
  });
  const tipoDoDia = new Map(marcas.map((e) => [`${e.employeeId}|${isoDia(e.date)}`, e.type as string]));

  const detalhe: FaltasParaEscala["detalhe"] = [];
  const pessoas = linhas
    .map((l) => {
      // O dia de hoje não conta: a batida pode ainda não ter chegado. Dia pendente nunca é falta (apurarDia já garante).
      const diasDeFalta = l.periodo.dias.filter((d) => d.falta && d.data < hoje && TIPOS_QUE_VIRAM_FALTA.has(tipoDoDia.get(`${l.employeeId}|${d.data}`)));
      for (const d of diasDeFalta) detalhe.push({ employeeId: l.employeeId, data: d.data, antes: tipoDoDia.get(`${l.employeeId}|${d.data}`) ?? null });
      return { employeeId: l.employeeId, nome: l.nome, dias: diasDeFalta.map((d) => d.data) };
    })
    .filter((x) => x.dias.length > 0);
  return { faltas: detalhe.length, pessoas, detalhe };
}

export async function faltasParaEscala(p: { year: number; month: number; userId: string; simular: boolean }): Promise<FaltasParaEscala> {
  const dias = diasDoMes(p.year, p.month);
  const [inicio, fim] = [diaDate(dias[0]), diaDate(dias[dias.length - 1])];
  try {
    await assertPeriodWritableForRange(inicio, fim, "Lancamento de faltas do ponto na escala");
  } catch (err) {
    throw new PontoRecusa(409, err instanceof Error ? err.message : "Período fechado.");
  }
  if (p.simular) return { ...(await faltasPendentes(prisma, p.year, p.month)), gravadas: false };

  // Ler e gravar na mesma transação, sob a trava do mês: nada muda entre a conta e a gravação.
  return prisma.$transaction(async (tx) => {
    await travarMeses(tx, [chaveTravaMes(p.year, p.month)]);
    const pendentes = await faltasPendentes(tx, p.year, p.month);
    for (const d of pendentes.detalhe) {
      const date = diaDate(d.data);
      if (d.antes === null) {
        await tx.employeeScheduleDay.createMany({ data: [{ employeeId: d.employeeId, date, type: "FALTA", notes: notaDoPonto(null), createdById: p.userId }], skipDuplicates: true });
      } else {
        // Só troca se o dia ainda for turno ou evento: nada de sobrescrever férias, atestado ou afastamento lançados no meio.
        await tx.employeeScheduleDay.updateMany({
          where: { employeeId: d.employeeId, date, type: { in: ["TURNO", "EVENTO"] } },
          data: { type: "FALTA", notes: notaDoPonto(d.antes) },
        });
      }
    }
    return { ...pendentes, gravadas: pendentes.faltas > 0 };
  }, { timeout: 60_000, maxWait: 10_000 });
}
