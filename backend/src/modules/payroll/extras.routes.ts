import { Router } from "express";
import { prisma } from "../../config/database.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { auditLog, getSessionUser, type SessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import {
  JUSTIFICATIVA_MINIMA, LIMITE_CURTO, LIMITE_LONGO, auditoria, campoLongoDemais, hojeEmSaoPaulo, lerData, oneOf,
  periodoBloqueado, podeVerDadosDeFora, str, violouUnico, ymd,
} from "./extras-comum.js";
import { lerHorario, lerValoresDiaria, resumirDiarias, type DiariaParaResumo } from "./extras-calc.js";
import { custoExtrasSql } from "./extras-custo.js";
import { apelidoDe, nomeCompleto } from "./nomes.js";
import { getOrDefaultSettings } from "./payroll.service.js";

// Extras por diária. Quem já trabalha no restaurante vem do cadastro de
// Funcionários (sem cadastrar de novo); quem vem de fora ganha cadastro leve.
export const extrasRouter = Router();

const REASONS = ["COBERTURA_FALTA", "COBERTURA_FOLGA", "COBERTURA_FERIAS", "EVENTO", "MOVIMENTO", "OUTRO"] as const;
const STATUSES = ["PREVISTA", "REALIZADA", "NAO_COMPARECEU", "CANCELADA"] as const;
const PIX_TYPES = ["CPF", "CNPJ", "EMAIL", "TELEFONE", "ALEATORIA"] as const;

function cpfValido(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const d = 11 - (soma % 11);
    return d >= 10 ? 0 : d;
  };
  return digito(9) === Number(c[9]) && digito(10) === Number(c[10]);
}

async function valoresPadrao() {
  const s = await getOrDefaultSettings();
  return { inteira: Number(s.diariaValor), meia: Number(s.meiaDiariaValor) };
}

// ─── CONFIGURAÇÃO: valor único da diária ──────────────────────────────────────
extrasRouter.get("/settings", async (_request, response) => {
  const p = await valoresPadrao();
  response.json({ diariaValor: p.inteira, meiaDiariaValor: p.meia });
});

extrasRouter.put("/settings", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const inteira = Number(String(b.diariaValor ?? "").replace(",", "."));
  const meia = Number(String(b.meiaDiariaValor ?? "").replace(",", "."));
  if (!Number.isFinite(inteira) || inteira <= 0 || !Number.isFinite(meia) || meia <= 0) {
    return response.status(400).json({ message: "Informe valores maiores que zero para a diária e a meia diária." });
  }
  if (meia > inteira) return response.status(400).json({ message: "A meia diária não pode valer mais que a diária inteira." });

  const antes = await valoresPadrao();
  await prisma.payrollSettings.update({
    where: { id: "singleton" },
    data: { diariaValor: inteira, meiaDiariaValor: meia, updatedById: user.id },
  });
  await auditLog({
    userId: user.id, action: "UPDATE_EXTRAS_SETTINGS", entity: "PayrollSettings", entityId: "singleton",
    previousValue: { diariaValor: antes.inteira, meiaDiariaValor: antes.meia },
    newValue: { diariaValor: inteira, meiaDiariaValor: meia }, ...auditoria(request),
  });
  response.json({ diariaValor: inteira, meiaDiariaValor: meia });
});

// ─── PESSOAS: equipe da casa (do cadastro) + pessoas de fora ─────────────────
extrasRouter.get("/people", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const incluirInativos = request.query.includeInactive === "true";
  const verDadosCasa = await podeVerDadosPessoais(request);
  const verDados = verDadosCasa || (await userHasPermission(user as SessionUser, "extras", "admin"));

  const [funcionarios, deFora] = await Promise.all([
    prisma.employee.findMany({
      where: { deletedAt: null, ...(incluirInativos ? {} : { isActive: true }) },
      select: { id: true, firstName: true, lastName: true, displayName: true, sector: true, position: true, modality: true, isActive: true, terminationDate: true, phone: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.extraWorker.findMany({
      where: { deletedAt: null, ...(incluirInativos ? {} : { isActive: true }) },
      orderBy: { fullName: "asc" },
    }),
  ]);

  response.json({
    podeVerDados: verDados,
    casa: funcionarios.map((e) => ({
      tipo: "CASA" as const,
      id: e.id,
      nome: nomeCompleto(e),
      apelido: apelidoDe(e),
      setor: e.sector,
      cargo: e.position,
      modalidade: e.modality,
      ativo: e.isActive,
      // Telefone e data de saída são dado de RH: só para quem vê Funcionários.
      desligadoEm: verDadosCasa && e.terminationDate ? ymd(e.terminationDate) : null,
      telefone: verDadosCasa ? e.phone : null,
    })),
    fora: deFora.map((w) => ({
      tipo: "FORA" as const,
      id: w.id,
      nome: w.fullName,
      apelido: w.displayName,
      telefone: w.phone,
      indicadoPor: w.referredBy,
      observacao: w.notes,
      ativo: w.isActive,
      cpf: verDados ? w.cpf : null,
      pixKeyType: verDados ? w.pixKeyType : null,
      pixKey: verDados ? w.pixKey : null,
    })),
  });
});

function lerPessoaDeFora(b: Record<string, unknown>):
  | { ok: true; dados: { fullName: string; displayName: string | null; cpf: string | null; phone: string | null; pixKeyType: string | null; pixKey: string | null; referredBy: string | null; notes: string | null } }
  | { ok: false; erro: string } {
  const fullName = str(b.fullName);
  if (!fullName || fullName.length < 3) return { ok: false, erro: "Informe o nome completo." };
  const longo = campoLongoDemais(b, [
    ["fullName", "Nome", LIMITE_CURTO], ["displayName", "Apelido", LIMITE_CURTO], ["phone", "Telefone", 40],
    ["pixKey", "Chave PIX", LIMITE_CURTO], ["referredBy", "Indicado por", LIMITE_CURTO], ["notes", "Observação", LIMITE_LONGO],
  ]);
  if (longo) return { ok: false, erro: longo };
  const cpfBruto = str(b.cpf);
  const cpf = cpfBruto ? cpfBruto.replace(/\D/g, "") : null;
  if (cpf && !cpfValido(cpf)) return { ok: false, erro: "CPF inválido." };
  const pixKey = str(b.pixKey);
  const pixKeyType = oneOf(PIX_TYPES, b.pixKeyType);
  if (pixKey && !pixKeyType) return { ok: false, erro: "Informe o tipo da chave PIX." };
  return {
    ok: true,
    dados: {
      fullName: fullName.replace(/\s+/g, " "),
      displayName: str(b.displayName),
      cpf,
      phone: str(b.phone),
      pixKeyType: pixKey ? pixKeyType : null,
      pixKey,
      referredBy: str(b.referredBy),
      notes: str(b.notes),
    },
  };
}

const CPF_REPETIDO = "Este CPF já está cadastrado.";

// Mesmo CPF de alguém do cadastro de Funcionários: é gente da casa, não de fora.
// O nome só aparece para quem vê dados pessoais — senão a tela viraria um jeito
// de descobrir de quem é um CPF qualquer.
async function cpfConflito(cpf: string | null, verDados: boolean, ignorarId?: string) {
  if (!cpf) return null;
  const formatado = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const funcionario = await prisma.employee.findFirst({ where: { deletedAt: null, cpf: { in: [cpf, formatado] } }, select: { firstName: true, lastName: true } });
  if (funcionario) {
    const quem = verDados ? `de ${nomeCompleto(funcionario)}, que já está` : "de alguém que já está";
    return `Este CPF é ${quem} no cadastro de Funcionários. Lance a diária escolhendo a pessoa em "Equipe da casa".`;
  }
  const outro = await prisma.extraWorker.findFirst({ where: { cpf, deletedAt: null, ...(ignorarId ? { id: { not: ignorarId } } : {}) }, select: { fullName: true } });
  if (outro) return verDados ? `Este CPF já está cadastrado para ${outro.fullName}.` : CPF_REPETIDO;
  return null;
}

extrasRouter.post("/people", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const verDados = await podeVerDadosDeFora(request, user as SessionUser);
  // Quem não vê CPF/PIX também não os grava: o formulário nem mostra esses campos.
  const b = request.body as Record<string, unknown>;
  const lido = lerPessoaDeFora(verDados ? b : { ...b, cpf: null, pixKeyType: null, pixKey: null });
  if (!lido.ok) return response.status(400).json({ message: lido.erro });
  const conflito = await cpfConflito(lido.dados.cpf, verDados);
  if (conflito) return response.status(400).json({ message: conflito });

  let criado;
  try {
    criado = await prisma.extraWorker.create({ data: { ...lido.dados, createdById: user.id } });
  } catch (error) {
    if (violouUnico(error)) return response.status(400).json({ message: CPF_REPETIDO });
    throw error;
  }
  await auditLog({
    userId: user.id, action: "CREATE_EXTRA_WORKER", entity: "ExtraWorker", entityId: criado.id,
    newValue: { fullName: criado.fullName, referredBy: criado.referredBy }, ...auditoria(request),
  });
  response.status(201).json({ id: criado.id });
});

extrasRouter.put("/people/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existente = await prisma.extraWorker.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existente) return response.status(404).json({ message: "Pessoa não encontrada." });

  const b = request.body as Record<string, unknown>;
  // Quem não vê CPF/PIX recebe esses campos vazios na lista; sem esta guarda,
  // salvar o formulário apagaria os dados que a pessoa nem enxergava.
  const verDados = await podeVerDadosDeFora(request, user as SessionUser);
  const corpo = verDados ? b : { ...b, cpf: existente.cpf, pixKeyType: existente.pixKeyType, pixKey: existente.pixKey };
  const lido = lerPessoaDeFora(corpo);
  if (!lido.ok) return response.status(400).json({ message: lido.erro });
  // Só confere conflito quando o CPF mudou: um CPF já salvo que depois passou a
  // existir em Funcionários não pode travar a edição do telefone.
  const cpfMudou = lido.dados.cpf !== existente.cpf;
  const conflito = cpfMudou ? await cpfConflito(lido.dados.cpf, verDados, existente.id) : null;
  if (conflito) return response.status(400).json({ message: conflito });

  const isActive = typeof b.isActive === "boolean" ? b.isActive : existente.isActive;
  try {
    await prisma.extraWorker.update({ where: { id: existente.id }, data: { ...lido.dados, isActive, updatedById: user.id } });
  } catch (error) {
    if (violouUnico(error)) return response.status(400).json({ message: CPF_REPETIDO });
    throw error;
  }
  // Troca de PIX/CPF é o caminho clássico de desviar pagamento: fica registrada
  // (sem o valor, que é dado pessoal).
  await auditLog({
    userId: user.id, action: "UPDATE_EXTRA_WORKER", entity: "ExtraWorker", entityId: existente.id,
    previousValue: { fullName: existente.fullName, isActive: existente.isActive },
    newValue: {
      fullName: lido.dados.fullName, isActive, cpfAlterado: cpfMudou,
      pixAlterado: lido.dados.pixKey !== existente.pixKey || lido.dados.pixKeyType !== existente.pixKeyType,
    },
    ...auditoria(request),
  });
  response.json({ ok: true });
});

extrasRouter.delete("/people/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existente = await prisma.extraWorker.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existente) return response.status(404).json({ message: "Pessoa não encontrada." });
  const diarias = await prisma.extraShift.count({ where: { extraWorkerId: existente.id, deletedAt: null } });
  if (diarias > 0) {
    return response.status(400).json({ message: `${existente.fullName} tem ${diarias} diária(s) lançada(s). Desative o cadastro em vez de excluir, para o histórico continuar legível.` });
  }
  await prisma.extraWorker.update({ where: { id: existente.id }, data: { deletedAt: new Date(), deletedById: user.id } });
  await auditLog({
    userId: user.id, action: "DELETE_EXTRA_WORKER", entity: "ExtraWorker", entityId: existente.id,
    previousValue: { fullName: existente.fullName }, ...auditoria(request),
  });
  response.json({ ok: true });
});

// ─── DIÁRIAS ───────────────────────────────────────────────────────────────────
const includeDiaria = {
  employee: { select: { firstName: true, lastName: true, displayName: true, modality: true } },
  extraWorker: { select: { fullName: true, displayName: true } },
  coveredEmployee: { select: { firstName: true, lastName: true, displayName: true } },
  payment: { select: { code: true, status: true, paymentDate: true } },
} as const;

type DiariaComPessoas = Awaited<ReturnType<typeof buscarDiarias>>[number];

function buscarDiarias(inicio: Date, fim: Date) {
  return prisma.extraShift.findMany({
    where: { deletedAt: null, date: { gte: inicio, lt: fim } },
    include: includeDiaria,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
}

function paraTela(d: DiariaComPessoas) {
  const casa = d.employee;
  return {
    id: d.id,
    date: ymd(d.date),
    origem: casa ? ("CASA" as const) : ("FORA" as const),
    pessoaId: d.employeeId ?? d.extraWorkerId!,
    pessoaNome: casa ? nomeCompleto(casa) : d.extraWorker!.fullName,
    pessoaApelido: casa ? apelidoDe(casa) : d.extraWorker!.displayName,
    modalidade: casa?.modality ?? null,
    sector: d.sector,
    role: d.role,
    startTime: d.startTime,
    endTime: d.endTime,
    duration: d.duration,
    reason: d.reason,
    coveredEmployeeId: d.coveredEmployeeId,
    coveredNome: d.coveredEmployee ? (apelidoDe(d.coveredEmployee) ?? nomeCompleto(d.coveredEmployee)) : null,
    baseAmount: Number(d.baseAmount),
    baseAdjustReason: d.baseAdjustReason,
    transportAmount: Number(d.transportAmount),
    bonusAmount: Number(d.bonusAmount),
    discountAmount: Number(d.discountAmount),
    totalAmount: Number(d.totalAmount),
    status: d.status,
    notes: d.notes,
    paymentId: d.paymentId,
    paymentCode: d.payment?.code ?? null,
    pago: d.payment?.status === "PAID",
  };
}

extrasRouter.get("/shifts", async (request, response) => {
  const now = new Date();
  const anoPedido = Number.parseInt(String(request.query.year ?? ""), 10);
  const year = anoPedido >= 2000 && anoPedido <= 2100 ? anoPedido : now.getFullYear();
  const month = Math.min(Math.max(Number.parseInt(String(request.query.month ?? ""), 10) || now.getMonth() + 1, 1), 12);
  const inicio = new Date(Date.UTC(year, month - 1, 1));
  const fim = new Date(Date.UTC(year, month, 1));

  const itens = (await buscarDiarias(inicio, fim)).map(paraTela);
  const resumo = resumirDiarias(itens.map((i): DiariaParaResumo => ({
    status: i.status, duration: i.duration, totalAmount: i.totalAmount, sector: i.sector,
    reason: i.reason, pessoaId: i.pessoaId, pessoaNome: i.pessoaNome, origem: i.origem,
  })));
  // Diferença de valor pago nos títulos (mesma regra do DRE): entra no gasto
  // do mês para a tela e o DRE mostrarem o mesmo número.
  const [dif] = await prisma.$queryRaw<Array<{ total: string | null }>>`
    SELECT SUM(c.valor)::text AS total FROM (${custoExtrasSql}) c
    WHERE NOT c.diaria AND c.dia >= ${inicio} AND c.dia < ${fim}
  `;
  const diferencaPaga = Math.round(Number(dif?.total ?? 0) * 100) / 100;
  response.json({
    year, month, itens, padrao: await valoresPadrao(),
    resumo: { ...resumo, diferencaPaga, custoRealizado: Math.round((resumo.custoRealizado + diferencaPaga) * 100) / 100 },
  });
});

type LeituraDiaria =
  | { ok: false; status: number; erro: string }
  | {
      ok: true;
      dados: {
        date: Date; employeeId: string | null; extraWorkerId: string | null; sector: string; role: string | null;
        startTime: string | null; endTime: string | null; duration: "INTEIRA" | "MEIA"; reason: (typeof REASONS)[number];
        coveredEmployeeId: string | null; status: (typeof STATUSES)[number]; notes: string | null;
        baseAmount: number; baseAdjustReason: string | null; transportAmount: number; bonusAmount: number; discountAmount: number; totalAmount: number;
      };
    };

type DiariaGravada = Awaited<ReturnType<typeof prisma.extraShift.findFirstOrThrow>>;

// Campo ausente na edição herda o gravado; presente e inválido é recusado —
// antes, qualquer coisa estranha virava REALIZADA/INTEIRA em silêncio e uma
// diária cancelada voltava a custar dinheiro.
function lerOpcao<T extends readonly string[]>(list: T, v: unknown, herdado: T[number] | undefined, padrao: T[number]): T[number] | null {
  if (v === undefined || v === null || v === "") return herdado ?? padrao;
  return oneOf(list, v);
}

async function lerDiaria(b: Record<string, unknown>, existente?: DiariaGravada): Promise<LeituraDiaria> {
  const date = lerData(b.date);
  if (!date) return { ok: false, status: 400, erro: "Informe a data da diária." };
  const longo = campoLongoDemais(b, [
    ["sector", "Setor", LIMITE_CURTO], ["role", "Função", LIMITE_CURTO],
    ["baseAdjustReason", "Motivo do valor", LIMITE_LONGO], ["notes", "Observação", LIMITE_LONGO],
  ]);
  if (longo) return { ok: false, status: 400, erro: longo };

  const employeeId = str(b.employeeId);
  const extraWorkerId = str(b.extraWorkerId);
  if (Boolean(employeeId) === Boolean(extraWorkerId)) return { ok: false, status: 400, erro: "Escolha uma pessoa: da equipe da casa ou de fora." };

  if (employeeId) {
    const e = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } });
    if (!e) return { ok: false, status: 400, erro: "Funcionário não encontrado." };
  } else {
    const w = await prisma.extraWorker.findFirst({ where: { id: extraWorkerId!, deletedAt: null }, select: { id: true } });
    if (!w) return { ok: false, status: 400, erro: "Pessoa de fora não encontrada." };
  }

  const sector = str(b.sector);
  if (!sector) return { ok: false, status: 400, erro: "Informe o setor." };
  const reason = oneOf(REASONS, b.reason);
  if (!reason) return { ok: false, status: 400, erro: "Informe o motivo da diária." };
  const status = lerOpcao(STATUSES, b.status, existente?.status, "REALIZADA");
  if (!status) return { ok: false, status: 400, erro: "Situação inválida." };
  const duration = lerOpcao(["INTEIRA", "MEIA"] as const, b.duration, existente?.duration, "INTEIRA");
  if (!duration) return { ok: false, status: 400, erro: "Duração inválida." };
  // Realizada no futuro entraria no gasto do mês antes de acontecer.
  if (status === "REALIZADA" && ymd(date) > hojeEmSaoPaulo()) {
    return { ok: false, status: 400, erro: "Diária de data futura fica como Prevista. Marque Realizada depois do dia." };
  }

  const startTime = lerHorario(b.startTime);
  const endTime = lerHorario(b.endTime);
  if (startTime === false || endTime === false) return { ok: false, status: 400, erro: "Horário inválido. Use o formato 08:00." };

  const coveredEmployeeId = str(b.coveredEmployeeId);
  if (coveredEmployeeId) {
    if (coveredEmployeeId === employeeId) return { ok: false, status: 400, erro: "A pessoa não pode cobrir a si mesma." };
    const c = await prisma.employee.findFirst({ where: { id: coveredEmployeeId, deletedAt: null }, select: { id: true } });
    if (!c) return { ok: false, status: 400, erro: "Funcionário coberto não encontrado." };
  }

  const anterior = existente
    ? { duration: existente.duration, baseAmount: Number(existente.baseAmount), baseAdjustReason: existente.baseAdjustReason }
    : undefined;
  const valores = lerValoresDiaria({ ...b, duration }, await valoresPadrao(), anterior);
  if (!valores.ok) return { ok: false, status: 400, erro: valores.erro };

  // Uma diária por pessoa por dia. Cancelada e "não compareceu" não contam,
  // senão não daria para relançar quem foi chamado de novo. O índice único
  // parcial no banco garante o mesmo contra cliques simultâneos.
  const duplicada = await prisma.extraShift.findFirst({
    where: {
      deletedAt: null, date, status: { in: ["PREVISTA", "REALIZADA"] },
      ...(employeeId ? { employeeId } : { extraWorkerId }),
      ...(existente ? { id: { not: existente.id } } : {}),
    },
    select: { id: true },
  });
  if (duplicada && (status === "PREVISTA" || status === "REALIZADA")) {
    return { ok: false, status: 409, erro: DIARIA_DUPLICADA };
  }

  return {
    ok: true,
    dados: {
      date, employeeId, extraWorkerId, sector, role: str(b.role), startTime, endTime,
      duration, reason, coveredEmployeeId, status, notes: str(b.notes), ...valores.valores,
    },
  };
}

const DIARIA_DUPLICADA = "Esta pessoa já tem diária lançada neste dia.";
const EM_PAGAMENTO_AGORA = "Esta diária acabou de entrar num pagamento. Recarregue a tela.";

extrasRouter.post("/shifts", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const lido = await lerDiaria(request.body as Record<string, unknown>);
  if (!lido.ok) return response.status(lido.status).json({ message: lido.erro });
  if (await periodoBloqueado(lido.dados.date, "Lançamento de diária", response)) return;

  let criada;
  try {
    criada = await prisma.extraShift.create({ data: { ...lido.dados, createdById: user.id } });
  } catch (error) {
    if (violouUnico(error)) return response.status(409).json({ message: DIARIA_DUPLICADA });
    throw error;
  }
  await auditLog({
    userId: user.id, action: "CREATE_EXTRA_SHIFT", entity: "ExtraShift", entityId: criada.id,
    newValue: { ...lido.dados, date: ymd(lido.dados.date) }, ...auditoria(request),
  });
  response.status(201).json({ id: criada.id });
});

extrasRouter.put("/shifts/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existente = await prisma.extraShift.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existente) return response.status(404).json({ message: "Diária não encontrada." });
  // Diária já num pagamento: o título no Contas a Pagar é a soma delas. Mudar
  // uma aqui deixaria o título com valor errado.
  if (existente.paymentId) {
    const pg = await prisma.extraPayment.findUnique({ where: { id: existente.paymentId }, select: { code: true } });
    return response.status(400).json({ message: `Esta diária está no pagamento ${pg?.code ?? ""}. Cancele o pagamento (aba Pagamentos) antes de alterar.` });
  }

  const lido = await lerDiaria(request.body as Record<string, unknown>, existente);
  if (!lido.ok) return response.status(lido.status).json({ message: lido.erro });
  // Mudar a data move o custo de mês: os dois meses precisam estar abertos.
  if (await periodoBloqueado(existente.date, "Alteração de diária", response)) return;
  if (await periodoBloqueado(lido.dados.date, "Alteração de diária", response)) return;

  try {
    // paymentId: null na condição — se a diária entrou num pagamento depois da
    // checagem acima, a edição não passa (o título ficaria com a soma antiga).
    const r = await prisma.extraShift.updateMany({ where: { id: existente.id, paymentId: null, deletedAt: null }, data: { ...lido.dados, updatedById: user.id } });
    if (r.count === 0) return response.status(409).json({ message: EM_PAGAMENTO_AGORA });
  } catch (error) {
    if (violouUnico(error)) return response.status(409).json({ message: DIARIA_DUPLICADA });
    throw error;
  }
  await auditLog({
    userId: user.id, action: "UPDATE_EXTRA_SHIFT", entity: "ExtraShift", entityId: existente.id,
    previousValue: { ...existente, date: ymd(existente.date) }, newValue: { ...lido.dados, date: ymd(lido.dados.date) }, ...auditoria(request),
  });
  response.json({ ok: true });
});

extrasRouter.delete("/shifts/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existente = await prisma.extraShift.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existente) return response.status(404).json({ message: "Diária não encontrada." });
  // Diária já num pagamento: o título no Contas a Pagar é a soma delas. Mudar
  // uma aqui deixaria o título com valor errado.
  if (existente.paymentId) {
    const pg = await prisma.extraPayment.findUnique({ where: { id: existente.paymentId }, select: { code: true } });
    return response.status(400).json({ message: `Esta diária está no pagamento ${pg?.code ?? ""}. Cancele o pagamento (aba Pagamentos) antes de alterar.` });
  }
  const motivo = String((request.body as { reason?: unknown })?.reason ?? "").trim();
  if (motivo.length < JUSTIFICATIVA_MINIMA) return response.status(400).json({ message: "Informe o motivo da exclusão (mín. 3 caracteres)." });
  if (motivo.length > LIMITE_LONGO) return response.status(400).json({ message: `Motivo da exclusão: máximo de ${LIMITE_LONGO} caracteres.` });
  if (await periodoBloqueado(existente.date, "Exclusão de diária", response)) return;

  const excluida = await prisma.extraShift.updateMany({ where: { id: existente.id, paymentId: null, deletedAt: null }, data: { deletedAt: new Date(), deletedById: user.id, deleteReason: motivo } });
  if (excluida.count === 0) return response.status(409).json({ message: EM_PAGAMENTO_AGORA });
  await auditLog({
    userId: user.id, action: "DELETE_EXTRA_SHIFT", entity: "ExtraShift", entityId: existente.id,
    previousValue: { ...existente, date: ymd(existente.date) }, newValue: { reason: motivo }, ...auditoria(request),
  });
  response.json({ ok: true });
});
