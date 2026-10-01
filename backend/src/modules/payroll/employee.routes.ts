import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";
import { CAMPOS_SALARIO, ROTULO_CAMPO, alteracoes, faltaMotivoRetroativo, lerVigenteDesde, type CampoHistorico } from "./cadastro-historico.js";
import { registrarAlteracoes } from "./cadastro-historico.service.js";

export const employeeRouter = Router();

// ─── validação CPF ────────────────────────────────────────────────────────────
function validateCpf(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
}

// ─── enums permitidos (validação de entrada) ───────────────────────────────────
const MODALITIES = ["CLT", "NAO_CLT"] as const;
const REGIMES = ["SEIS_POR_UM", "CINCO_POR_DOIS"] as const;
const VT_TYPES = ["NENHUM", "TRANSPORTE_PUBLICO", "BILHETE_MENSAL", "AUXILIO_COMBUSTIVEL"] as const;
const VT_PERIODICITIES = ["QUINZENAL", "MENSAL"] as const;
const VT_DIRECTIONS = ["IDA", "VOLTA"] as const;
const GENDERS = ["FEMININO", "MASCULINO", "NAO_INFORMADO"] as const;
const ACCOUNT_TYPES = ["CONTA_CORRENTE", "POUPANCA", "CAIXA", "CARTEIRA", "CARTAO", "OUTROS"] as const;

function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number];
function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: null): T[number] | null;
function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: T[number] | null): T[number] | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

// ─── coerção de campos ──────────────────────────────────────────────────────────
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function dateOrNull(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}
function digits(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d === "" ? null : d;
}

// Campos do cadastro compartilhados por create e update (sem id/auditoria).
function buildEmployeeData(b: Record<string, unknown>) {
  return {
    firstName: str(b.firstName)!,
    lastName: str(b.lastName)!,
    displayName: str(b.displayName),
    rg: str(b.rg),
    pis: digits(b.pis),
    birthDate: dateOrNull(b.birthDate),
    gender: oneOf(GENDERS, b.gender, "NAO_INFORMADO"),
    phone: str(b.phone),
    email: str(b.email),
    zipCode: str(b.zipCode),
    address: str(b.address),
    addressNumber: str(b.addressNumber),
    addressComplement: str(b.addressComplement),
    neighborhood: str(b.neighborhood),
    city: str(b.city),
    state: str(b.state)?.toUpperCase().slice(0, 2) ?? null,
    bankName: str(b.bankName),
    bankAgency: str(b.bankAgency),
    bankAccount: str(b.bankAccount),
    bankAccountDigit: str(b.bankAccountDigit),
    bankAccountType: oneOf(ACCOUNT_TYPES, b.bankAccountType, "CONTA_CORRENTE"),
    pixKeyType: str(b.pixKeyType),
    pixKey: str(b.pixKey),
    sector: str(b.sector),
    subgroup: str(b.subgroup),
    position: str(b.position),
    baseSalary: numOrNull(b.baseSalary),
    shiftStart: str(b.shiftStart),
    shiftEnd: str(b.shiftEnd),
    modality: oneOf(MODALITIES, b.modality, "CLT"),
    scheduleRegime: oneOf(REGIMES, b.scheduleRegime, "SEIS_POR_UM"),
    includeInSchedule: b.includeInSchedule === undefined ? true : Boolean(b.includeInSchedule),
    admissionDate: dateOrNull(b.admissionDate),
    // Ausente = não mexe (a importação do extrato também grava este campo).
    ...("admissaoCarteira" in b ? { admissaoCarteira: dateOrNull(b.admissaoCarteira) } : {}),
    vtType: oneOf(VT_TYPES, b.vtType, "TRANSPORTE_PUBLICO"),
    vtPeriodicity: oneOf(VT_PERIODICITIES, b.vtPeriodicity, "QUINZENAL"),
    notes: str(b.notes),
    // A tarifa mensal e o valor de ajuda de custo só são gravados quando o
    // corpo os traz. Ausente = não mexe — mesma proteção do trajeto (vtLegs).
    //
    // Sem isso, abrir a ficha de quem usa Bilhete Único, trocar o tipo de VT
    // para olhar outra opção e salvar apagava a tarifa escolhida: o funcionário
    // ficava BILHETE_MENSAL apontando para nada e o vale saía R$ 0,00. É o
    // mesmo modo de falha que sumiu com 5 vales em julho.
    ...("vtMonthlyFareId" in b ? { vtMonthlyFareId: str(b.vtMonthlyFareId) } : {}),
    ...("vtFixedAmount" in b ? { vtFixedAmount: numOrNull(b.vtFixedAmount) } : {}),
  };
}

// Salário combinado: quem ganha acima do registrado (na folha sai combinado − adiantamento
// + gorjeta). Só é gravado quando o corpo traz o campo; vazio tira. Com valor, exige motivo.
type SalarioCombinado = { salarioCombinado?: number | null; salarioCombinadoMotivo?: string | null };
export function lerSalarioCombinado(b: Record<string, unknown>): { erro: string } | { dados: SalarioCombinado } {
  if (!("salarioCombinado" in b)) return { dados: {} };
  if (b.salarioCombinado == null || b.salarioCombinado === "") {
    return { dados: { salarioCombinado: null, salarioCombinadoMotivo: null } };
  }
  const valor = Number(b.salarioCombinado);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 100000) return { erro: "Salário combinado inválido." };
  const motivo = str(b.salarioCombinadoMotivo)?.slice(0, 300) ?? null;
  if (!motivo || motivo.length < 5) return { erro: "Explique o salário combinado (pelo menos 5 letras)." };
  return { dados: { salarioCombinado: valor, salarioCombinadoMotivo: motivo } };
}

// Teto do IR para a gorjeta informada (CLT): o envio à contabilidade leva teto − salário
// registrado; a pessoa continua recebendo a gorjeta dos pontos. Só é gravado quando o corpo
// traz o campo; vazio tira. Sem registro não tem (a gorjeta dele não vai à contabilidade).
export const ERRO_TETO_SO_CLT = "O teto do IR para a gorjeta só vale para quem é CLT.";
export function lerTetoIrGorjeta(b: Record<string, unknown>, modality: string): { erro: string } | { dados: { tetoIrGorjeta?: number | null } } {
  if (!("tetoIrGorjeta" in b)) return { dados: {} };
  if (b.tetoIrGorjeta == null || b.tetoIrGorjeta === "") return { dados: { tetoIrGorjeta: null } };
  const valor = Number(b.tetoIrGorjeta);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 100000) return { erro: "Teto do IR para a gorjeta inválido." };
  if (modality !== "CLT") return { erro: ERRO_TETO_SO_CLT };
  return { dados: { tetoIrGorjeta: Math.round(valor * 100) / 100 } };
}

// Recebe adiantamento salarial (no dia do adiantamento) ou só no pagamento. Só é gravado
// quando o corpo traz o campo, e só como booleano: "false" em texto não pode virar true.
export function lerRecebeAdiantamento(b: Record<string, unknown>): { erro: string } | { dados: { recebeAdiantamento?: boolean } } {
  if (!("recebeAdiantamento" in b)) return { dados: {} };
  if (typeof b.recebeAdiantamento !== "boolean") return { erro: "Informe se recebe adiantamento salarial (sim ou não)." };
  return { dados: { recebeAdiantamento: b.recebeAdiantamento } };
}

type FormaPagamento = { recebeAdiantamento?: boolean; pagamentoQuinzenal?: boolean };
export const ERRO_DUAS_FORMAS_PAGAMENTO =
  "Escolha uma forma de pagamento só: adiantamento no dia do adiantamento OU por quinzena (dias 15 e 30). As duas juntas descontariam duas vezes.";

// Forma de pagamento do sem registro: só no pagamento, adiantamento ou quinzena. Cada campo
// só é gravado quando o corpo o traz, e só como booleano. Adiantamento e quinzena juntos são
// recusados olhando o que vai ficar gravado (o que veio no corpo, senão o cadastro atual):
// marcar a quinzena em quem já recebe adiantamento, sem desmarcar o adiantamento, também cai.
export function lerFormaPagamento(
  b: Record<string, unknown>, atual: FormaPagamento | null = null,
): { erro: string } | { dados: FormaPagamento } {
  const adiantamento = lerRecebeAdiantamento(b);
  if ("erro" in adiantamento) return adiantamento;
  let quinzena: FormaPagamento = {};
  if ("pagamentoQuinzenal" in b) {
    if (typeof b.pagamentoQuinzenal !== "boolean") return { erro: "Informe se recebe por quinzena (sim ou não)." };
    quinzena = { pagamentoQuinzenal: b.pagamentoQuinzenal };
  }
  const dados = { ...adiantamento.dados, ...quinzena };
  const ficaAdiantamento = dados.recebeAdiantamento ?? atual?.recebeAdiantamento ?? false;
  const ficaQuinzena = dados.pagamentoQuinzenal ?? atual?.pagamentoQuinzenal ?? false;
  if (ficaAdiantamento && ficaQuinzena) return { erro: ERRO_DUAS_FORMAS_PAGAMENTO };
  return { dados };
}

// Salário, vínculo, cargo etc. mudaram: a data a partir da qual vale ("vigenteDesde",
// padrão hoje em São Paulo) e o motivo vão para o histórico do cadastro. Sem mudança
// nesses campos a data nem é conferida.
export function lerVigencia(
  b: Record<string, unknown>, antes: Record<string, unknown>, depois: Record<string, unknown>, admissao: Date | null, hojeIso = hojeEmSaoPaulo(),
): { erro: string } | { vigenteDesde: Date | null; motivo: string | null } {
  const mudancas = alteracoes(antes, depois);
  if (mudancas.length === 0) return { vigenteDesde: null, motivo: null };
  const lido = lerVigenteDesde(b.vigenteDesde, hojeIso, admissao);
  if ("erro" in lido) return lido;
  const motivo = str(b.motivoAlteracao)?.slice(0, 300) ?? null;
  const falta = faltaMotivoRetroativo(mudancas.map((m) => m.campo), lido.data, hojeIso, motivo);
  if (falta) return { erro: falta };
  return { vigenteDesde: lido.data, motivo };
}

// Trajeto: lista de pernas por sentido. O corpo manda a lista inteira e ela
// substitui a anterior — meio-termo (só remover a perna X) não existe aqui,
// porque a ordem das pernas importa e reconciliar item a item convida a erro.
type LegInput = { direction: "IDA" | "VOLTA"; fareId: string };

function parseLegs(v: unknown): LegInput[] | null {
  if (!Array.isArray(v)) return null;
  const legs: LegInput[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const direction = oneOf(VT_DIRECTIONS, r.direction, null);
    const fareId = str(r.fareId);
    if (!direction || !fareId) continue;
    legs.push({ direction, fareId });
  }
  return legs;
}

// Reescreve as pernas dentro de uma transação: apagar e recriar em passos
// separados deixaria o funcionário sem trajeto se o segundo passo falhasse,
// e trajeto vazio é exatamente o bug que faz o vale sair R$ 0,00.
async function replaceLegs(employeeId: string, legs: LegInput[]) {
  const fareIds = Array.from(new Set(legs.map((l) => l.fareId)));
  const validFares = fareIds.length
    ? await prisma.vtFare.findMany({ where: { id: { in: fareIds } }, select: { id: true } })
    : [];
  const valid = new Set(validFares.map((f) => f.id));
  const unknown = fareIds.filter((id) => !valid.has(id));
  if (unknown.length > 0) throw new Error("Tarifa de transporte inexistente no trajeto.");

  const byDirection = { IDA: 0, VOLTA: 0 };
  const rows = legs.map((l) => ({
    id: crypto.randomUUID(),
    employeeId,
    direction: l.direction,
    fareId: l.fareId,
    sortOrder: byDirection[l.direction]++,
  }));

  await prisma.$transaction([
    prisma.employeeVtLeg.deleteMany({ where: { employeeId } }),
    ...(rows.length ? [prisma.employeeVtLeg.createMany({ data: rows })] : []),
  ]);
}

const employeeInclude = {
  vtLegs: { include: { fare: true }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }] },
  vtMonthlyFare: true,
} satisfies Prisma.EmployeeInclude;

// ─── LIST ──────────────────────────────────────────────────────────────────────
employeeRouter.get("/", async (request, response) => {
  const search = str(request.query.search);
  const sector = str(request.query.sector);
  const includeInactive = request.query.includeInactive === "true";

  const where: Prisma.EmployeeWhereInput = { deletedAt: null };
  if (!includeInactive) where.isActive = true;
  if (sector) where.sector = sector;
  if (search) {
    const cpfDigits = search.replace(/\D/g, "");
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { position: { contains: search, mode: "insensitive" } },
      ...(cpfDigits ? [{ cpf: { contains: cpfDigits } }] : []),
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
    include: employeeInclude,
  });
  response.json(employees);
});

// ─── ANIVERSARIANTES ────────────────────────────────────────────────────────────
// Registrada antes de "/:id" para não ser capturada como id.
employeeRouter.get("/birthdays", async (request, response) => {
  const month = intOrNull(request.query.month) ?? new Date().getMonth() + 1;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, "firstName", "lastName", "displayName", "birthDate", sector, position
    FROM "Employee"
    WHERE "deletedAt" IS NULL AND "isActive" = true AND "birthDate" IS NOT NULL
      AND EXTRACT(MONTH FROM "birthDate") = ${month}
    ORDER BY EXTRACT(DAY FROM "birthDate") ASC, "firstName" ASC
  `;
  response.json(rows);
});

// ─── OPÇÕES (setores e cargos já usados — para combobox "escolha ou crie") ────────
// Registrada antes de "/:id" para não ser capturada como id.
employeeRouter.get("/options", async (_request, response) => {
  const rows = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { sector: true, position: true },
  });
  const clean = (values: Array<string | null>) =>
    Array.from(new Set(values.map((v) => (v ?? "").trim()).filter((v) => v !== ""))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  response.json({
    sectors: clean(rows.map((r) => r.sector)),
    positions: clean(rows.map((r) => r.position)),
  });
});

// ─── HISTÓRICO DO CADASTRO ─────────────────────────────────────────────────────────
// Mais recente primeiro. Salário só com a permissão de ver Funcionários: sem ela, a
// linha de salário aparece como "alterado", sem os valores.
employeeRouter.get("/:id/historico", async (request, response) => {
  const employee = await prisma.employee.findFirst({ where: { id: request.params.id }, select: { id: true } });
  if (!employee) return response.status(404).json({ message: "Funcionário não encontrado." });
  const verSalario = await podeVerDadosPessoais(request);
  const linhas = await prisma.employeeHistorico.findMany({
    where: { employeeId: employee.id },
    orderBy: [{ vigenteDesde: "desc" }, { createdAt: "desc" }],
  });
  const empresaIds = [...new Set(linhas.filter((l) => l.campo === "companyId").flatMap((l) => [l.valorAnterior, l.valorNovo]).filter((x): x is string => Boolean(x)))];
  const empresas = empresaIds.length
    ? new Map((await prisma.company.findMany({ where: { id: { in: empresaIds } }, select: { id: true, tradeName: true } })).map((c) => [c.id, c.tradeName]))
    : new Map<string, string>();
  const mostrar = (campo: string, v: string | null) => (campo === "companyId" && v ? empresas.get(v) ?? v : v);
  return response.json(linhas.map((l) => {
    const oculto = CAMPOS_SALARIO.has(l.campo as CampoHistorico) && !verSalario;
    return {
      id: l.id,
      campo: l.campo,
      rotulo: ROTULO_CAMPO[l.campo as CampoHistorico] ?? l.campo,
      valorAnterior: oculto ? null : mostrar(l.campo, l.valorAnterior),
      valorNovo: oculto ? null : mostrar(l.campo, l.valorNovo),
      oculto,
      vigenteDesde: l.vigenteDesde.toISOString().slice(0, 10),
      // O motivo de um aumento costuma citar o valor ("de 2.200 para 2.500"): oculto também.
      motivo: oculto ? null : l.motivo,
      origem: l.origem,
      criadoPorNome: l.criadoPorNome,
      createdAt: l.createdAt.toISOString(),
    };
  }));
});

// ─── GET ONE ─────────────────────────────────────────────────────────────────────
employeeRouter.get("/:id", async (request, response) => {
  const employee = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null }, include: employeeInclude });
  if (!employee) return response.status(404).json({ message: "Funcionário não encontrado." });
  return response.json(employee);
});

// ─── CREATE ───────────────────────────────────────────────────────────────────────
employeeRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as Record<string, unknown>;
  const firstName = str(b.firstName);
  const lastName = str(b.lastName);
  const cpfRaw = str(b.cpf);

  if (!firstName) return response.status(400).json({ message: "Nome é obrigatório." });
  if (!lastName) return response.status(400).json({ message: "Sobrenome é obrigatório." });
  if (!cpfRaw) return response.status(400).json({ message: "CPF é obrigatório." });

  const cpf = cpfRaw.replace(/\D/g, "");
  if (!validateCpf(cpf)) return response.status(400).json({ message: "CPF inválido." });

  const existing = await prisma.employee.findFirst({ where: { cpf, deletedAt: null } });
  if (existing) return response.status(400).json({ message: "Já existe um funcionário com este CPF." });
  const combinado = lerSalarioCombinado(b);
  if ("erro" in combinado) return response.status(400).json({ message: combinado.erro });
  const adiantamento = lerFormaPagamento(b);
  if ("erro" in adiantamento) return response.status(400).json({ message: adiantamento.erro });
  const teto = lerTetoIrGorjeta(b, buildEmployeeData(b).modality);
  if ("erro" in teto) return response.status(400).json({ message: teto.erro });
  if ("tetoIrGorjeta" in teto.dados && !(await podeVerDadosPessoais(request))) return response.status(403).json({ message: "Exige permissão de ver Funcionários." });

  const legs = parseLegs(b.vtLegs);

  const created = await prisma.employee.create({
    data: {
      id: crypto.randomUUID(),
      cpf,
      ...buildEmployeeData(b),
      ...combinado.dados,
      ...adiantamento.dados,
      ...teto.dados,
      isActive: true,
      createdById: user.id,
    },
  });
  if (legs) {
    try {
      await replaceLegs(created.id, legs);
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Trajeto inválido." });
    }
  }

  await auditLog({
    userId: user.id,
    action: "CREATE_EMPLOYEE",
    entity: "Employee",
    entityId: created.id,
    newValue: created,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.status(201).json(created);
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────────
employeeRouter.put("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const b = request.body as Record<string, unknown>;
  const firstName = str(b.firstName);
  const lastName = str(b.lastName);
  const cpfRaw = str(b.cpf);

  if (!firstName) return response.status(400).json({ message: "Nome é obrigatório." });
  if (!lastName) return response.status(400).json({ message: "Sobrenome é obrigatório." });
  if (!cpfRaw) return response.status(400).json({ message: "CPF é obrigatório." });

  const cpf = cpfRaw.replace(/\D/g, "");
  if (!validateCpf(cpf)) return response.status(400).json({ message: "CPF inválido." });

  const cpfConflict = await prisma.employee.findFirst({
    where: { cpf, deletedAt: null, id: { not: request.params.id } },
  });
  if (cpfConflict) return response.status(400).json({ message: "CPF já está em uso por outro funcionário." });
  const combinado = lerSalarioCombinado(b);
  if ("erro" in combinado) return response.status(400).json({ message: combinado.erro });
  const adiantamento = lerFormaPagamento(b, existing);
  if ("erro" in adiantamento) return response.status(400).json({ message: adiantamento.erro });
  const base = buildEmployeeData(b);
  const teto = lerTetoIrGorjeta(b, base.modality);
  if ("erro" in teto) return response.status(400).json({ message: teto.erro });
  // O teto com o salário dá a gorjeta informada: mexer nele exige ver salários.
  if ("tetoIrGorjeta" in teto.dados && !(await podeVerDadosPessoais(request))) return response.status(403).json({ message: "Exige permissão de ver Funcionários." });
  const dados = { cpf, ...base, ...combinado.dados, ...adiantamento.dados, ...teto.dados };
  const vigencia = lerVigencia(b, existing, dados, dados.admissionDate ?? existing.admissionDate);
  if ("erro" in vigencia) return response.status(400).json({ message: vigencia.erro });

  // Trajeto só é reescrito quando o corpo traz "vtLegs". Um PUT sem o campo
  // (uma tela antiga, um script) não pode apagar o trajeto de ninguém em
  // silêncio — o vale dessa pessoa sairia zerado no fechamento seguinte.
  const legs = parseLegs(b.vtLegs);
  if (legs) {
    try {
      await replaceLegs(request.params.id, legs);
    } catch (error) {
      return response.status(400).json({ message: error instanceof Error ? error.message : "Trajeto inválido." });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const atualizado = await tx.employee.update({
      where: { id: request.params.id },
      data: { ...dados, updatedById: user.id },
      include: employeeInclude,
    });
    if (vigencia.vigenteDesde) {
      await registrarAlteracoes(tx, {
        employeeId: atualizado.id, antes: existing, depois: dados, vigenteDesde: vigencia.vigenteDesde,
        motivo: vigencia.motivo, origem: "CADASTRO", usuario: { id: user.id, nome: user.name },
      });
    }
    return atualizado;
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE_EMPLOYEE",
    entity: "Employee",
    entityId: updated.id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── TOGGLE STATUS (ativar / inativar sem desligamento formal) ────────────────────
employeeRouter.patch("/:id/status", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const isActive = Boolean((request.body as { isActive?: unknown }).isActive);
  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: isActive
      ? { isActive: true, terminationDate: null, terminationReason: null, updatedById: user.id }
      : { isActive: false, updatedById: user.id },
  });

  await auditLog({
    userId: user.id,
    action: isActive ? "REACTIVATE_EMPLOYEE" : "INACTIVATE_EMPLOYEE",
    entity: "Employee",
    entityId: updated.id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── DESLIGAMENTO ─────────────────────────────────────────────────────────────────
employeeRouter.patch("/:id/terminate", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const b = request.body as Record<string, unknown>;
  // Meia-noite UTC do dia de HOJE EM SÃO PAULO, não o instante atual: o cálculo do VT
  // compara dia a dia em UTC. Antes o "hoje" era o dia em UTC, e um desligamento
  // gravado às 22h de Brasília já caía no dia SEGUINTE — pagando um dia de vale que a
  // pessoa não vai usar (justamente o que este comentário dizia evitar).
  const hojeUtc = new Date(`${hojeEmSaoPaulo()}T00:00:00.000Z`);
  const terminationDate = dateOrNull(b.terminationDate) ?? hojeUtc;
  const terminationReason = str(b.terminationReason);

  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: { terminationDate, terminationReason, isActive: false, updatedById: user.id },
  });

  await auditLog({
    userId: user.id,
    action: "TERMINATE_EMPLOYEE",
    entity: "Employee",
    entityId: updated.id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── SALDO DE FOLGA POR FERIADO (banco de folgas) ─────────────────────────────────
// Ajusta o saldo (delta +/-). Feriado trabalhado gera folga a mais; ao tirar a
// folga, debita. Nunca fica negativo.
employeeRouter.patch("/:id/holiday-comp", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const delta = intOrNull((request.body as { delta?: unknown }).delta) ?? 0;
  const newBalance = Math.max(0, existing.holidayCompBalance + delta);

  const updated = await prisma.employee.update({
    where: { id: request.params.id },
    data: { holidayCompBalance: newBalance, updatedById: user.id },
  });

  await auditLog({
    userId: user.id, action: "ADJUST_HOLIDAY_COMP", entity: "Employee", entityId: updated.id,
    previousValue: { holidayCompBalance: existing.holidayCompBalance },
    newValue: { holidayCompBalance: newBalance },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, holidayCompBalance: updated.holidayCompBalance });
});

// ─── RESTAURAR (desfazer exclusão) ──────────────────────────────────────────────
// Volta o funcionário como INATIVO (deletedAt limpo). Reative com "Reativar".
employeeRouter.patch("/:id/restore", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: { not: null } } });
  if (!existing) return response.status(404).json({ message: "Funcionário excluído não encontrado (talvez já restaurado)." });

  const updated = await prisma.employee.update({
    where: { id: existing.id },
    data: { deletedAt: null, deletedById: null, updatedById: user.id },
  });

  await auditLog({
    userId: user.id, action: "RESTORE_EMPLOYEE", entity: "Employee", entityId: updated.id,
    newValue: { restored: true }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, isActive: updated.isActive });
});

// ─── DELETE (soft) ────────────────────────────────────────────────────────────────
employeeRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.employee.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Funcionário não encontrado." });

  const reason = String((request.body as { reason?: unknown })?.reason ?? "").trim();
  if (reason.length < 3) return response.status(400).json({ message: "Informe a justificativa da exclusão (mín. 3 caracteres)." });

  await prisma.employee.update({
    where: { id: request.params.id },
    data: { deletedAt: new Date(), deletedById: user.id, isActive: false },
  });

  await auditLog({
    userId: user.id,
    action: "DELETE_EMPLOYEE",
    entity: "Employee",
    entityId: request.params.id,
    previousValue: existing,
    newValue: { reason },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ ok: true });
});
