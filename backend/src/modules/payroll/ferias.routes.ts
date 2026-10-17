import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";
import {
  DIAS_ABONO, diaValido, periodosDeFerias, piorNivel, somarDias, somarMeses,
  type HistoricoFerias, type NivelAlerta, type PeriodoFerias, type Programacao, type ProgramacaoNoPeriodo,
} from "./ferias-calc.js";
import { SEMANAS_DE_ESCALA_LIDAS, feriadosEntre, motivoInicioVedado, repousoDaPessoa } from "./ferias-vedados.js";

// ─── Programação de férias ──────────────────────────────────────────────────────
//
// Montado em /payroll/ferias: o controle de acesso resolve pelo prefixo /payroll, o mesmo
// módulo da Folha. Só entra quem é CLT, ativo e sem data de saída. A data-base é a de
// registro em carteira (a que a contabilidade usa no relatório) e, na falta dela, a admissão.
// Toda gravação trava a linha do funcionário (FOR UPDATE): dois cliques ou duas abas não
// conseguem, juntos, passar de 30 dias no mesmo período.

export const feriasRouter = Router();

const MIN_DIAS_GOZO = 5;
const MAX_PARTES = 3;
const MIN_DIAS_PARTE_MAIOR = 14;
const ANOS_A_FRENTE = 2;
const ST_PROGRAMADA = "PROGRAMADA";
const ST_GOZADA = "GOZADA";

class Recusa extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const isoDia = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const paraData = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const nomeDe = (e: { firstName: string; lastName: string; displayName: string | null }) =>
  e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();

export type PessoaFerias = {
  employeeId: string;
  nome: string;
  empresa: string | null;
  setor: string | null;
  /** Dias da semana (0 = domingo) de repouso, pelas folgas da escala; domingo quando a escala não mostra um padrão. */
  repousoSemanal: number[];
  repousoPelaEscala: boolean;
  admissao: string | null;
  nivel: NivelAlerta;
  periodos: PeriodoFerias[];
};

// Folgas das últimas semanas, para descobrir o dia de repouso de cada pessoa.
const desde = (hoje: string) => paraData(somarDias(hoje, -7 * SEMANAS_DE_ESCALA_LIDAS));
const selectPessoa = (hoje: string, comEscala = true) => ({
  ...SELECT_PESSOA,
  ...(comEscala ? { scheduleDays: { where: { type: "FOLGA" as const, date: { gte: desde(hoje), lte: paraData(hoje) } }, select: { date: true } } } : {}),
});

const SELECT_PESSOA = {
  id: true, firstName: true, lastName: true, displayName: true, sector: true, scheduleRegime: true, admissionDate: true, admissaoCarteira: true,
  company: { select: { tradeName: true } },
  feriasProgramadas: { orderBy: { gozoInicio: "asc" as const } },
  feriasRegistradas: { select: { aquisitivoInicio: true, gozoInicio: true, gozoFim: true, abonoInicio: true, abonoFim: true } },
} as const;

type LinhaPessoa = {
  id: string; firstName: string; lastName: string; displayName: string | null; sector?: string | null;
  admissionDate: Date | null; admissaoCarteira: Date | null;
  scheduleRegime?: string;
  scheduleDays?: Array<{ date: Date }>;
  company: { tradeName: string | null } | null;
  feriasProgramadas: Array<{ id: string; aquisitivoInicio: Date; gozoInicio: Date | null; dias: number; diasAbono: number; status: string; observacao: string | null; avisadoEm?: Date | null }>;
  feriasRegistradas: Array<{ aquisitivoInicio: Date; gozoInicio: Date | null; gozoFim: Date | null; abonoInicio: Date | null; abonoFim: Date | null }>;
};

export function montarPessoa(e: LinhaPessoa, hoje: string): PessoaFerias {
  const base = isoDia(e.admissaoCarteira ?? e.admissionDate);
  const programacoes: Programacao[] = e.feriasProgramadas.map((p) => ({
    id: p.id,
    aquisitivoInicio: isoDia(p.aquisitivoInicio) as string,
    gozoInicio: isoDia(p.gozoInicio),
    dias: p.dias,
    diasAbono: p.diasAbono,
    status: p.status === ST_GOZADA ? ST_GOZADA : ST_PROGRAMADA,
    observacao: p.observacao,
    avisadoEm: p.avisadoEm ? p.avisadoEm.toISOString() : null,
  }));
  const historico: HistoricoFerias[] = e.feriasRegistradas.map((h) => ({
    aquisitivoInicio: isoDia(h.aquisitivoInicio) as string,
    gozoInicio: isoDia(h.gozoInicio), gozoFim: isoDia(h.gozoFim),
    abonoInicio: isoDia(h.abonoInicio), abonoFim: isoDia(h.abonoFim),
  }));
  const periodos = base ? periodosDeFerias({ admissao: base, hoje, programacoes, historico }) : [];
  const repouso = repousoDaPessoa((e.scheduleDays ?? []).map((d) => isoDia(d.date) as string), e.scheduleRegime === "CINCO_POR_DOIS");
  return {
    employeeId: e.id, nome: nomeDe(e), empresa: e.company?.tradeName ?? null, setor: e.sector?.trim() || null,
    repousoSemanal: repouso.repousos, repousoPelaEscala: repouso.inferido,
    admissao: base, nivel: piorNivel(periodos), periodos,
  };
}

const PESSOAS_ATIVAS_CLT = { deletedAt: null, isActive: true, terminationDate: null, modality: "CLT" as const };

/**
 * `comEscala: false` pula a leitura das folgas (só serve para o dia de repouso): quem só conta alertas,
 * como o Dashboard, não precisa dela.
 */
export async function carregarFerias(hoje = hojeEmSaoPaulo(), { comEscala = true } = {}): Promise<PessoaFerias[]> {
  const linhas = await prisma.employee.findMany({ where: PESSOAS_ATIVAS_CLT, select: selectPessoa(hoje, comEscala), orderBy: { firstName: "asc" } });
  return linhas.map((e) => montarPessoa(e, hoje));
}

/** Contagem para o alerta do Dashboard: quantos períodos vencidos e quantos vencem em até 90 dias. */
export function contarAlertas(pessoas: PessoaFerias[]) {
  const periodos = pessoas.flatMap((p) => p.periodos);
  const vencidas = periodos.filter((p) => p.situacao === "VENCIDA" || p.foraDoPrazo).length;
  const aVencer = periodos.filter((p) => p.situacao === "A_VENCER" && !p.foraDoPrazo).length;
  return { vencidas, aVencer };
}

// ─── GET /payroll/ferias ────────────────────────────────────────────────────────
feriasRouter.get("/", async (_request, response) => {
  const hoje = hojeEmSaoPaulo();
  const pessoas = await carregarFerias(hoje);
  const semData = pessoas.filter((p) => !p.admissao).map((p) => ({ employeeId: p.employeeId, nome: p.nome }));
  // Feriados do ano passado até o limite de datas aceitas: a tela marca e evita os dias vedados.
  const feriados = feriadosEntre(somarMeses(hoje, -12), somarMeses(hoje, 12 * (ANOS_A_FRENTE + 1)));
  response.json({ hoje, pessoas: pessoas.filter((p) => p.admissao), semDataDeAdmissao: semData, resumo: contarAlertas(pessoas), feriados });
});

// ─── entrada e trava ────────────────────────────────────────────────────────────
type Cliente = Prisma.TransactionClient;
type Pedido = { aquisitivoInicio: string; gozoInicio: string | null; dias: number; diasAbono: number; status: string; observacao: string | null };

function inteiro(v: unknown, nome: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new Recusa(400, `${nome} deve ser um número inteiro entre ${min} e ${max}.`);
  return n;
}

function idDe(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new Recusa(400, "Funcionário é obrigatório.");
  return v;
}

/** Roda `fn` com a linha do funcionário travada: gravações concorrentes da mesma pessoa esperam a vez. */
const comTrava = <T>(employeeId: string, fn: (tx: Cliente) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Employee" WHERE "id" = ${employeeId} FOR UPDATE`;
    return fn(tx);
  }, { timeout: 10_000 });

async function pessoaDe(db: Cliente, employeeId: string, hoje: string): Promise<PessoaFerias> {
  const e = await db.employee.findFirst({ where: { id: employeeId, ...PESSOAS_ATIVAS_CLT }, select: selectPessoa(hoje) });
  if (!e) throw new Recusa(404, "Funcionário CLT ativo não encontrado.");
  const pessoa = montarPessoa(e, hoje);
  if (!pessoa.admissao) throw new Recusa(400, "Funcionário sem data de admissão: cadastre antes de programar férias.");
  return pessoa;
}

function pedidoDe(b: Record<string, unknown>): Pedido {
  if (!diaValido(b.aquisitivoInicio)) throw new Recusa(400, "Período aquisitivo inválido.");
  if (b.status !== undefined && b.status !== ST_PROGRAMADA && b.status !== ST_GOZADA) throw new Recusa(400, "Situação inválida.");
  if (!diaValido(b.gozoInicio)) throw new Recusa(400, "Informe a data de início das férias.");
  const observacao = typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim().slice(0, 300) : null;
  return {
    aquisitivoInicio: b.aquisitivoInicio, gozoInicio: b.gozoInicio, observacao,
    status: b.status === ST_GOZADA ? ST_GOZADA : ST_PROGRAMADA,
    dias: inteiro(b.dias, "Dias de férias", 1, 30),
    diasAbono: b.diasAbono === undefined || b.diasAbono === null || b.diasAbono === "" ? 0 : inteiro(b.diasAbono, "Dias de abono", 0, DIAS_ABONO),
  };
}

// "Já gozou" sem datas: quita o saldo do período (férias tiradas antes de existir a tela, ou
// que a contabilidade já tem). Fica gravado como GOZADA, sem data de início.
function pedidoJaGozado(b: Record<string, unknown>, periodo: PeriodoFerias | undefined): Pedido {
  if (!diaValido(b.aquisitivoInicio) || !periodo) throw new Recusa(400, "Período aquisitivo inválido.");
  if (periodo.diasPendentes <= 0) throw new Recusa(400, "Esse período não tem dias a quitar.");
  return { aquisitivoInicio: b.aquisitivoInicio, gozoInicio: null, dias: periodo.diasPendentes, diasAbono: 0, status: ST_GOZADA, observacao: "Marcado como já gozado, sem datas." };
}

// ─── regras de uma programação ──────────────────────────────────────────────────
const mesmoGozo = (a: { inicio: string; fim: string }, b: { inicio: string; fim: string }) => a.inicio <= b.fim && b.inicio <= a.fim;

/** Outro gozo da mesma pessoa (de qualquer período) que bate com as datas do pedido. */
function sobreposto(pedido: Pedido, pessoa: PessoaFerias, excetoId?: string): ProgramacaoNoPeriodo | undefined {
  if (!pedido.gozoInicio) return undefined;
  const novo = { inicio: pedido.gozoInicio, fim: somarDias(pedido.gozoInicio, pedido.dias - 1) };
  return pessoa.periodos.flatMap((p) => p.programacoes)
    .find((g) => g.id !== excetoId && g.gozoInicio && g.gozoFim && mesmoGozo(novo, { inicio: g.gozoInicio, fim: g.gozoFim }));
}

function validarDatas(pedido: Pedido, periodo: PeriodoFerias, hoje: string) {
  if (!pedido.gozoInicio) return;
  if (pedido.gozoInicio <= periodo.aquisitivoFim) throw new Recusa(400, "O gozo começa depois do fim do período aquisitivo.");
  if (pedido.gozoInicio > somarMeses(hoje, 12 * ANOS_A_FRENTE)) throw new Recusa(400, `A data de início não pode passar de ${ANOS_A_FRENTE} anos à frente.`);
  if (pedido.status === ST_GOZADA && pedido.gozoInicio > hoje) throw new Recusa(400, "Férias que ainda não começaram não podem ser marcadas como gozadas.");
}

/** O início não pode cair em dia vedado. Só vale para o que está sendo combinado (férias já gozadas são histórico). */
function validarDiaDeInicio(pedido: Pedido, repousos: number[], atual?: { gozoInicio?: Date | null }) {
  if (!pedido.gozoInicio || pedido.status !== ST_PROGRAMADA) return;
  if (atual && isoDia(atual.gozoInicio ?? null) === pedido.gozoInicio) return; // não mudou a data: editar a observação não pode travar
  const motivo = motivoInicioVedado(pedido.gozoInicio, feriadosEntre(somarDias(pedido.gozoInicio, -3), somarDias(pedido.gozoInicio, 3)), repousos);
  if (motivo) throw new Recusa(400, `As férias não podem começar em ${dataBr(pedido.gozoInicio)}: ${motivo} (CLT, art. 134, § 3º). Escolha outro dia.`);
}

function validarDias(pedido: Pedido, periodo: PeriodoFerias, excetoId?: string) {
  const proprio = excetoId ? periodo.programacoes.find((p) => p.id === excetoId) : undefined;
  const livre = periodo.diasPendentes + (proprio ? proprio.dias + proprio.diasAbono : 0);
  const abonoJa = periodo.diasAbono - (proprio?.diasAbono ?? 0);
  if (abonoJa + pedido.diasAbono > DIAS_ABONO) throw new Recusa(400, `Esse período já vendeu ${abonoJa} dias de abono; o máximo é ${DIAS_ABONO}.`);
  const pedidos = pedido.dias + pedido.diasAbono;
  if (pedidos > livre) throw new Recusa(400, `Esse período tem ${livre} ${plural(livre, "dia", "dias")} a programar; o pedido soma ${pedidos}.`);
  if (!pedido.gozoInicio) return;
  const resto = livre - pedidos;
  if (pedido.dias < MIN_DIAS_GOZO && resto !== 0) {
    throw new Recusa(400, `Cada parte das férias tem no mínimo ${MIN_DIAS_GOZO} dias, a não ser que seja tudo o que sobra (${livre}).`);
  }
  if (resto > 0 && resto < MIN_DIAS_GOZO) {
    throw new Recusa(400, `Sobrariam ${resto} ${plural(resto, "dia", "dias")}, menos que o mínimo de ${MIN_DIAS_GOZO} por parte. Use tudo de uma vez ou deixe ao menos ${MIN_DIAS_GOZO}.`);
  }
  const outras = periodo.programacoes.filter((p) => p.id !== excetoId && p.gozoInicio);
  if (outras.length + 1 > MAX_PARTES) throw new Recusa(400, `As férias de um período podem ser divididas em no máximo ${MAX_PARTES} partes.`);
  const maior = Math.max(pedido.dias, ...outras.map((p) => p.dias));
  if (resto === 0 && outras.length > 0 && maior < MIN_DIAS_PARTE_MAIOR) {
    throw new Recusa(400, `Quando as férias são divididas, uma das partes precisa ter pelo menos ${MIN_DIAS_PARTE_MAIOR} dias.`);
  }
}

function validarContraPeriodo(pedido: Pedido, periodo: PeriodoFerias | undefined, hoje: string, repousos: number[], atual?: { id: string; gozoInicio?: Date | null }) {
  if (!periodo) throw new Recusa(400, "Período aquisitivo inválido para este funcionário.");
  if (periodo.situacao === "EM_AQUISICAO") throw new Recusa(400, "Esse período aquisitivo ainda não terminou: as férias só podem ser tiradas depois.");
  if (!atual && periodo.doHistorico) throw new Recusa(400, "Esse período já consta como gozado na ficha de registro da contabilidade.");
  validarDatas(pedido, periodo, hoje);
  validarDiaDeInicio(pedido, repousos, atual);
  validarDias(pedido, periodo, atual?.id);
}

const auditoria = (request: Parameters<typeof requestIp>[0]) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") || null });

function responderRecusa(err: unknown, response: { status: (c: number) => { json: (b: unknown) => unknown } }) {
  if (err instanceof Recusa) return response.status(err.status).json({ message: err.message });
  throw err;
}

// ─── POST /payroll/ferias — programar (ou lançar férias já gozadas) ─────────────
feriasRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as Record<string, unknown>;
  try {
    const employeeId = idDe(b.employeeId);
    const hoje = hojeEmSaoPaulo();
    const { criada, pedido } = await comTrava(employeeId, async (tx) => {
      const pessoa = await pessoaDe(tx, employeeId, hoje);
      const periodo = pessoa.periodos.find((p) => p.aquisitivoInicio === b.aquisitivoInicio);
      const pedido = b.semDatas === true ? pedidoJaGozado(b, periodo) : pedidoDe(b);
      validarContraPeriodo(pedido, periodo, hoje, pessoa.repousoSemanal);
      const choque = sobreposto(pedido, pessoa);
      if (choque) throw new Recusa(400, `Essas datas batem com outras férias dessa pessoa (${dataBr(choque.gozoInicio)} a ${dataBr(choque.gozoFim)}).`);
      const criada = await tx.feriasProgramacao.create({
        data: {
          employeeId, aquisitivoInicio: paraData(pedido.aquisitivoInicio),
          gozoInicio: pedido.gozoInicio ? paraData(pedido.gozoInicio) : null, dias: pedido.dias, diasAbono: pedido.diasAbono,
          status: pedido.status, observacao: pedido.observacao, createdById: user.id,
        },
      });
      return { criada, pedido };
    });
    await auditLog({
      userId: user.id, action: "SCHEDULE_VACATION", entity: "FeriasProgramacao", entityId: criada.id,
      newValue: { employeeId, ...pedido, gozoFim: pedido.gozoInicio ? somarDias(pedido.gozoInicio, pedido.dias - 1) : null },
      ...auditoria(request),
    });
    return response.status(201).json({ id: criada.id });
  } catch (err) {
    return responderRecusa(err, response);
  }
});

// ─── PATCH /payroll/ferias/:id — editar datas/dias ou marcar como gozada ─────────
feriasRouter.patch("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as Record<string, unknown>;
  try {
    const previa = await prisma.feriasProgramacao.findUnique({ where: { id: request.params.id }, select: { employeeId: true } });
    if (!previa) throw new Recusa(404, "Programação não encontrada.");
    const hoje = hojeEmSaoPaulo();
    const { atual, pedido } = await comTrava(previa.employeeId, async (tx) => {
      // Relida já com a trava: o que vale é o estado de agora, não o de antes da espera.
      const atual = await tx.feriasProgramacao.findUnique({ where: { id: request.params.id } });
      if (!atual) throw new Recusa(404, "Programação não encontrada.");
      const pessoa = await pessoaDe(tx, atual.employeeId, hoje);
      const pedido = pedidoDe({
        aquisitivoInicio: isoDia(atual.aquisitivoInicio),
        gozoInicio: b.gozoInicio ?? isoDia(atual.gozoInicio),
        dias: b.dias ?? atual.dias,
        diasAbono: b.diasAbono ?? atual.diasAbono,
        status: b.status ?? atual.status,
        observacao: b.observacao === undefined ? atual.observacao : b.observacao,
      });
      validarContraPeriodo(pedido, pessoa.periodos.find((p) => p.aquisitivoInicio === pedido.aquisitivoInicio), hoje, pessoa.repousoSemanal, atual);
      if (sobreposto(pedido, pessoa, atual.id)) throw new Recusa(400, "Essas datas batem com outras férias dessa pessoa.");
      await tx.feriasProgramacao.update({
        where: { id: atual.id },
        data: {
          gozoInicio: paraData(pedido.gozoInicio as string), dias: pedido.dias, diasAbono: pedido.diasAbono, status: pedido.status, observacao: pedido.observacao,
          // Datas novas pedem aviso novo: o de antes valia para outras datas.
          ...(isoDia(atual.gozoInicio) !== pedido.gozoInicio || atual.dias !== pedido.dias ? { avisadoEm: null, avisadoPorId: null } : {}),
        },
      });
      return { atual, pedido };
    });
    await auditLog({
      userId: user.id, action: "UPDATE_VACATION", entity: "FeriasProgramacao", entityId: atual.id,
      previousValue: { gozoInicio: isoDia(atual.gozoInicio), dias: atual.dias, diasAbono: atual.diasAbono, status: atual.status, observacao: atual.observacao },
      newValue: pedido, ...auditoria(request),
    });
    return response.json({ id: atual.id });
  } catch (err) {
    return responderRecusa(err, response);
  }
});

// ─── POST /payroll/ferias/:id/avisado — marcar (ou desmarcar) que a pessoa foi avisada ──────
feriasRouter.post("/:id/avisado", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = (request.body ?? {}) as Record<string, unknown>;
  if (typeof b.avisado !== "boolean") return response.status(400).json({ message: "Informe se a pessoa foi avisada (avisado: true ou false)." });
  try {
    const previa = await prisma.feriasProgramacao.findUnique({ where: { id: request.params.id }, select: { employeeId: true } });
    if (!previa) throw new Recusa(404, "Programação não encontrada.");
    const { atual, avisadoEm } = await comTrava(previa.employeeId, async (tx) => {
      const atual = await tx.feriasProgramacao.findUnique({ where: { id: request.params.id } });
      if (!atual) throw new Recusa(404, "Programação não encontrada.");
      if (atual.status !== ST_PROGRAMADA || !atual.gozoInicio) throw new Recusa(400, "Só dá para registrar o aviso de férias programadas, com data.");
      // Marcar de novo não troca a data nem quem marcou; desmarcar limpa os dois.
      const avisadoEm = b.avisado ? atual.avisadoEm ?? new Date() : null;
      await tx.feriasProgramacao.update({ where: { id: atual.id }, data: { avisadoEm, avisadoPorId: b.avisado ? atual.avisadoPorId ?? user.id : null } });
      return { atual, avisadoEm };
    });
    await auditLog({
      userId: user.id, action: b.avisado ? "NOTIFY_VACATION" : "UNDO_NOTIFY_VACATION", entity: "FeriasProgramacao", entityId: atual.id,
      newValue: { employeeId: atual.employeeId, gozoInicio: isoDia(atual.gozoInicio), avisado: b.avisado }, ...auditoria(request),
    });
    return response.json({ id: atual.id, avisadoEm: avisadoEm ? avisadoEm.toISOString() : null });
  } catch (err) {
    return responderRecusa(err, response);
  }
});

// ─── DELETE /payroll/ferias/:id — cancelar a programação (ou desfazer um "já gozou") ─
feriasRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const atual = await prisma.feriasProgramacao.findUnique({ where: { id: request.params.id } });
  if (!atual) return response.status(404).json({ message: "Programação não encontrada." });
  await prisma.feriasProgramacao.delete({ where: { id: atual.id } });
  await auditLog({
    userId: user.id, action: "CANCEL_VACATION", entity: "FeriasProgramacao", entityId: atual.id,
    previousValue: { employeeId: atual.employeeId, gozoInicio: isoDia(atual.gozoInicio), dias: atual.dias, diasAbono: atual.diasAbono, status: atual.status, observacao: atual.observacao },
    ...auditoria(request),
  });
  return response.json({ ok: true });
});
