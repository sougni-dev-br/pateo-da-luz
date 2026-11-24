import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { diaIsoValido, ordenarPessoasDoBrinde, resumirBrinde, type PessoaDoBrinde } from "./brinde.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";

// ─── Brinde para os colaboradores (RH → Brindes) ────────────────────────────────
// Montado em /payroll/brindes: o controle de acesso resolve pelo prefixo /payroll (módulo da Folha).
// Uma campanha por ocasião (ex.: "Brinde de Natal" 2026). A lista é a dos funcionários ativos; a entrega
// guarda quem recebeu, em que dia e quem marcou, e continua no registro mesmo se a pessoa sair depois.

export const brindeRouter = Router();

const MAX_LOTE = 500;
const auditoria = (request: Parameters<typeof requestIp>[0]) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") || null });
const nomeDe = (e: { firstName: string; lastName: string; displayName: string | null }) => e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();
const paraData = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDia = (d: Date) => d.toISOString().slice(0, 10);

const diaSchema = z.string().refine(diaIsoValido, "Data inválida.");
const observacaoSchema = z.string().trim().max(300).nullish().transform((v) => (v ? v : null));
const campanhaSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do brinde.").max(80),
  ano: z.number().int().min(2020).max(2100),
  observacao: observacaoSchema,
});
const entregaSchema = z.object({ entregueEm: diaSchema.optional(), observacao: observacaoSchema });
const loteSchema = z.object({ employeeIds: z.array(z.string().min(1)).min(1).max(MAX_LOTE), entregueEm: diaSchema.optional() });

const invalido = (erro: z.ZodError) => ({ message: erro.issues[0]?.message ?? "Dados inválidos." });

// ─── GET /payroll/brindes — campanhas, com o andamento de cada uma ──────────────
brindeRouter.get("/", async (_request, response) => {
  const [campanhas, ativos] = await Promise.all([
    prisma.brindeCampanha.findMany({
      orderBy: [{ ano: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { entregas: true } } },
    }),
    prisma.employee.count({ where: { isActive: true } }),
  ]);
  return response.json({
    hoje: hojeEmSaoPaulo(),
    ativos,
    campanhas: campanhas.map((c) => ({ id: c.id, nome: c.nome, ano: c.ano, observacao: c.observacao, entregues: c._count.entregas })),
  });
});

// ─── POST /payroll/brindes — abrir uma campanha ─────────────────────────────────
brindeRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = campanhaSchema.safeParse(request.body);
  if (!dados.success) return response.status(400).json(invalido(dados.error));
  const existente = await prisma.brindeCampanha.findUnique({ where: { nome_ano: { nome: dados.data.nome, ano: dados.data.ano } } });
  if (existente) return response.status(409).json({ message: `Já existe "${dados.data.nome}" de ${dados.data.ano}.`, id: existente.id });
  const criada = await prisma.brindeCampanha.create({ data: { ...dados.data, createdById: user.id } });
  await auditLog({ userId: user.id, action: "CREATE_GIFT_CAMPAIGN", entity: "BrindeCampanha", entityId: criada.id, newValue: dados.data, ...auditoria(request) });
  return response.status(201).json({ id: criada.id });
});

// ─── GET /payroll/brindes/:id — a lista: ativos + quem recebeu (mesmo que já tenha saído) ─
brindeRouter.get("/:id", async (request, response) => {
  const campanha = await prisma.brindeCampanha.findUnique({ where: { id: request.params.id } });
  if (!campanha) return response.status(404).json({ message: "Brinde não encontrado." });

  const entregas = await prisma.brindeEntrega.findMany({ where: { campanhaId: campanha.id } });
  const idsEntregues = entregas.map((e) => e.employeeId);
  const funcionarios = await prisma.employee.findMany({
    where: { OR: [{ isActive: true }, ...(idsEntregues.length ? [{ id: { in: idsEntregues } }] : [])] },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, sector: true, position: true,
      isActive: true, terminationDate: true, company: { select: { tradeName: true } },
    },
  });
  const quemMarcou = [...new Set(entregas.map((e) => e.registradoPorId).filter((v): v is string => !!v))];
  const usuarios = quemMarcou.length
    ? await prisma.user.findMany({ where: { id: { in: quemMarcou } }, select: { id: true, name: true } })
    : [];
  const nomeUsuario = new Map(usuarios.map((u) => [u.id, u.name]));
  const entregaDe = new Map(entregas.map((e) => [e.employeeId, e]));

  const pessoas: PessoaDoBrinde[] = ordenarPessoasDoBrinde(
    funcionarios.map((f) => {
      const e = entregaDe.get(f.id);
      return {
        employeeId: f.id,
        nome: nomeDe(f),
        nomeCompleto: `${f.firstName} ${f.lastName}`.trim(),
        empresa: f.company?.tradeName ?? null,
        setor: f.sector ?? null,
        cargo: f.position ?? null,
        ativo: f.isActive,
        saidaEm: f.isActive && f.terminationDate ? isoDia(f.terminationDate) : null,
        entrega: e ? { id: e.id, entregueEm: isoDia(e.entregueEm), observacao: e.observacao, registradoPor: e.registradoPorId ? nomeUsuario.get(e.registradoPorId) ?? null : null } : null,
      };
    }),
  );
  return response.json({
    hoje: hojeEmSaoPaulo(),
    campanha: { id: campanha.id, nome: campanha.nome, ano: campanha.ano, observacao: campanha.observacao },
    resumo: resumirBrinde(pessoas),
    pessoas,
  });
});

// ─── PUT /payroll/brindes/:id/entregas/:employeeId — marcar (ou corrigir) a entrega ────
brindeRouter.put("/:id/entregas/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = entregaSchema.safeParse(request.body ?? {});
  if (!dados.success) return response.status(400).json(invalido(dados.error));
  const { id: campanhaId, employeeId } = request.params;

  const [campanha, funcionario] = await Promise.all([
    prisma.brindeCampanha.findUnique({ where: { id: campanhaId }, select: { id: true } }),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, isActive: true } }),
  ]);
  if (!campanha) return response.status(404).json({ message: "Brinde não encontrado." });
  if (!funcionario) return response.status(404).json({ message: "Funcionário não encontrado." });

  const chave = { campanhaId_employeeId: { campanhaId, employeeId } };
  const anterior = await prisma.brindeEntrega.findUnique({ where: chave });
  if (!anterior && !funcionario.isActive) return response.status(409).json({ message: "Este funcionário não está ativo." });
  const entregueEm = paraData(dados.data.entregueEm ?? hojeEmSaoPaulo());
  // Corrigir só a data não apaga a observação, e vice-versa.
  const observacao = dados.data.observacao !== null || "observacao" in (request.body ?? {}) ? dados.data.observacao : anterior?.observacao ?? null;
  const salva = await prisma.brindeEntrega.upsert({
    where: chave,
    update: { entregueEm, observacao },
    create: { campanhaId, employeeId, entregueEm, observacao, registradoPorId: user.id },
  });
  await auditLog({
    userId: user.id, action: anterior ? "UPDATE_GIFT_DELIVERY" : "REGISTER_GIFT_DELIVERY", entity: "BrindeEntrega", entityId: salva.id,
    previousValue: anterior ? { entregueEm: isoDia(anterior.entregueEm), observacao: anterior.observacao } : undefined,
    newValue: { campanhaId, employeeId, entregueEm: isoDia(salva.entregueEm), observacao: salva.observacao },
    ...auditoria(request),
  });
  return response.status(anterior ? 200 : 201).json({ id: salva.id });
});

// ─── DELETE /payroll/brindes/:id/entregas/:employeeId — desfazer a marcação ─────
brindeRouter.delete("/:id/entregas/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const { id: campanhaId, employeeId } = request.params;
  const anterior = await prisma.brindeEntrega.findUnique({ where: { campanhaId_employeeId: { campanhaId, employeeId } } });
  if (!anterior) return response.status(404).json({ message: "Esta pessoa não está marcada como entregue." });
  await prisma.brindeEntrega.delete({ where: { id: anterior.id } });
  await auditLog({
    userId: user.id, action: "UNDO_GIFT_DELIVERY", entity: "BrindeEntrega", entityId: anterior.id,
    previousValue: { campanhaId, employeeId, entregueEm: isoDia(anterior.entregueEm), observacao: anterior.observacao },
    ...auditoria(request),
  });
  return response.json({ ok: true });
});

// ─── POST /payroll/brindes/:id/entregas/lote — marcar várias de uma vez ─────────
// Só quem ainda não está marcado e segue ativo; quem já tem entrega não muda de data.
brindeRouter.post("/:id/entregas/lote", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const dados = loteSchema.safeParse(request.body);
  if (!dados.success) return response.status(400).json(invalido(dados.error));
  const campanhaId = request.params.id;
  const campanha = await prisma.brindeCampanha.findUnique({ where: { id: campanhaId }, select: { id: true } });
  if (!campanha) return response.status(404).json({ message: "Brinde não encontrado." });

  const ids = [...new Set(dados.data.employeeIds)];
  const ativos = await prisma.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  const entregueEm = paraData(dados.data.entregueEm ?? hojeEmSaoPaulo());
  const criadas = await prisma.brindeEntrega.createMany({
    data: ativos.map((a) => ({ campanhaId, employeeId: a.id, entregueEm, registradoPorId: user.id })),
    skipDuplicates: true,
  });
  await auditLog({
    userId: user.id, action: "REGISTER_GIFT_DELIVERY_BATCH", entity: "BrindeCampanha", entityId: campanhaId,
    newValue: { entregueEm: isoDia(entregueEm), pedidos: ids.length, marcados: criadas.count },
    ...auditoria(request),
  });
  return response.json({ marcados: criadas.count, jaMarcadosOuInativos: ids.length - criadas.count });
});

// ─── DELETE /payroll/brindes/:id — apagar a campanha (e as entregas dela) ───────
brindeRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const campanha = await prisma.brindeCampanha.findUnique({ where: { id: request.params.id }, include: { _count: { select: { entregas: true } } } });
  if (!campanha) return response.status(404).json({ message: "Brinde não encontrado." });
  if (campanha._count.entregas > 0) return response.status(409).json({ message: "Este brinde já tem entregas registradas; desfaça-as antes de apagar." });
  await prisma.brindeCampanha.delete({ where: { id: campanha.id } });
  await auditLog({ userId: user.id, action: "DELETE_GIFT_CAMPAIGN", entity: "BrindeCampanha", entityId: campanha.id, previousValue: { nome: campanha.nome, ano: campanha.ano }, ...auditoria(request) });
  return response.json({ ok: true });
});
