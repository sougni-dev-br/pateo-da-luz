// Fichas cadastrais do lado do RH: gerar o link, acompanhar, conferir, completar a parte da
// empresa e concluir. Módulo de permissão próprio ("employee-forms"); concluir também exige
// poder criar (admissão) ou editar (atualização) Funcionários, porque grava no cadastro.
import { Router, type Request, type Response } from "express";
import { Prisma, type FichaCadastralStatus } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { mascararDadosSensiveis } from "./auditoria-mascara.js";
import {
  ESCOLARIDADES, ESTADOS_CIVIS, RACAS_CORES, ROTULOS, TIPOS_ARQUIVO, UFS,
  dadosDoFuncionario, diferencas, faltaParaFinalizar, filhosAlterados, filhosNovos, lerDadosEmpresa,
  type DadosEmpresa, type DadosPessoa,
} from "./ficha-cadastral-campos.js";
import { expiracaoNova, gerarCodigo } from "./ficha-cadastral-acesso.js";
import { ErroConclusao, concluirAdmissao, concluirAtualizacao } from "./ficha-cadastral-concluir.js";
import { enviarArquivo } from "./ficha-cadastral-arquivo.js";

export const fichaCadastralRouter = Router();

const ABERTAS: FichaCadastralStatus[] = ["ENVIADA", "PREENCHENDO", "FINALIZADA"];
const SITUACOES = new Set<string>(["ENVIADA", "PREENCHENDO", "FINALIZADA", "CONCLUIDA", "CANCELADA"]);
const auditoria = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function usuario(request: Request, response: Response): Promise<SessionUser | null> {
  const user = (await getSessionUser(request)) as SessionUser | null;
  if (!user) response.status(401).json({ message: "Sessão obrigatória." });
  return user;
}

// Parte da empresa já preenchida com o cadastro, na atualização: a ficha impressa sai completa.
function empresaDoFuncionario(e: {
  companyId: string | null; admissionDate: Date | null; position: string | null; baseSalary: Prisma.Decimal | null; modality: string;
  jornadaInicio: string | null; jornadaFim: string | null; intervaloInicio: string | null; intervaloFim: string | null; vtType: string;
}): Partial<DadosEmpresa> {
  return {
    companyId: e.companyId, admissao: dataIso(e.admissionDate), funcao: e.position,
    salario: e.baseSalary == null ? null : Number(e.baseSalary), modalidade: e.modality === "NAO_CLT" ? "NAO_CLT" : "CLT",
    entrada: e.jornadaInicio, saida: e.jornadaFim, intervaloInicio: e.intervaloInicio, intervaloFim: e.intervaloFim,
    valeTransporte: e.vtType !== "NENHUM",
  };
}

// ─── LISTA ──────────────────────────────────────────────────────────────────────
fichaCadastralRouter.get("/", async (request, response) => {
  const status = String(request.query.status ?? "");
  if (status && status !== "ABERTAS" && !SITUACOES.has(status)) return response.status(400).json({ message: "Situação inválida." });
  const where: Prisma.FichaCadastralWhereInput = status === "ABERTAS" ? { status: { in: ABERTAS } }
    : status ? { status: status as FichaCadastralStatus } : {};
  const employeeId = typeof request.query.employeeId === "string" ? request.query.employeeId : null;
  if (employeeId) where.employeeId = employeeId;
  const fichas = await prisma.fichaCadastral.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, tipo: true, status: true, nomeReferencia: true, employeeId: true, expiraEm: true, createdAt: true,
      primeiroAcessoEm: true, finalizadaEm: true, concluidaEm: true, canceladaEm: true, motivoDevolucao: true,
      employee: { select: { firstName: true, lastName: true } },
      _count: { select: { arquivos: true } },
    },
  });
  const agora = Date.now();
  return response.json(fichas.map((f) => ({
    ...f,
    arquivos: f._count.arquivos,
    _count: undefined,
    vencida: (f.status === "ENVIADA" || f.status === "PREENCHENDO") && f.expiraEm.getTime() < agora,
  })));
});

// ─── CRIAR (gera o link) ────────────────────────────────────────────────────────
fichaCadastralRouter.post("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const b = (request.body ?? {}) as Record<string, unknown>;
  const tipo = b.tipo === "ATUALIZACAO" ? "ATUALIZACAO" : b.tipo === "ADMISSAO" ? "ADMISSAO" : null;
  if (!tipo) return response.status(400).json({ message: "Escolha admissão ou atualização." });

  let nomeReferencia = String(b.nomeReferencia ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  let dados: DadosPessoa = {};
  let dadosEmpresa: Partial<DadosEmpresa> = {};
  let employeeId: string | null = null;
  if (tipo === "ATUALIZACAO") {
    const e = await prisma.employee.findFirst({ where: { id: String(b.employeeId ?? ""), deletedAt: null } });
    if (!e) return response.status(404).json({ message: "Funcionário não encontrado." });
    const aberta = await prisma.fichaCadastral.findFirst({ where: { employeeId: e.id, status: { in: ABERTAS } }, select: { id: true } });
    if (aberta) return response.status(409).json({ message: `Já existe uma ficha aberta para ${e.firstName}. Use "Gerar novo link" nela.`, fichaId: aberta.id });
    const filhos = await prisma.employeeDependente.findMany({ where: { employeeId: e.id }, select: { nome: true, dataNascimento: true, cpf: true } });
    dados = dadosDoFuncionario(e as unknown as Record<string, unknown>, filhos);
    dadosEmpresa = empresaDoFuncionario(e);
    employeeId = e.id;
    nomeReferencia = [e.firstName, e.lastName].filter(Boolean).join(" ");
  }
  if (nomeReferencia.length < 2) return response.status(400).json({ message: "Informe o nome da pessoa." });

  const { codigo, hash } = gerarCodigo();
  const ficha = await prisma.fichaCadastral.create({
    data: {
      tipo, tokenHash: hash, expiraEm: expiracaoNova(), nomeReferencia, employeeId,
      dados: dados as Prisma.InputJsonValue, dadosEmpresa: dadosEmpresa as Prisma.InputJsonValue, createdById: user.id,
    },
  });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_CRIADA", entity: "FichaCadastral", entityId: ficha.id, newValue: { tipo, nomeReferencia, employeeId }, ...auditoria(request) });
  return response.status(201).json({ id: ficha.id, codigo, expiraEm: ficha.expiraEm });
});

// ─── DETALHE ────────────────────────────────────────────────────────────────────
fichaCadastralRouter.get("/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await prisma.fichaCadastral.findUnique({
    where: { id: request.params.id },
    include: {
      arquivos: { select: { id: true, tipo: true, nomeOriginal: true, mimeType: true, tamanho: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      employee: { include: { dependentes: { select: { id: true, nome: true, dataNascimento: true, cpf: true } } } },
    },
  });
  if (!ficha) return response.status(404).json({ message: "Ficha não encontrada." });
  const dados = ficha.dados as DadosPessoa;
  const { employee, tokenHash: _hash, ...resto } = ficha;
  const compararCom = ficha.tipo === "ATUALIZACAO" && ficha.status !== "CONCLUIDA" && employee ? employee : null;
  // Salário (na atualização vem do cadastro) e os valores atuais do cadastro só para quem pode
  // ver Funcionários — a mesma regra do cadastro; sem ela, o RH confere a ficha sem esses valores.
  const verFuncionarios = await userHasPermission(user, "employees", "view");
  // Atualização: empresa, função, salário e jornada são os do cadastro HOJE (não os do dia em que
  // o link foi gerado) — a ficha impressa vai à contabilidade e não pode sair com salário velho.
  // Sábado, folga e observações continuam os que o RH digitou.
  const guardada = ficha.dadosEmpresa as Partial<DadosEmpresa>;
  const empresa = ficha.tipo === "ATUALIZACAO" && employee ? { ...guardada, ...empresaDoFuncionario(employee) } : guardada;
  const dadosEmpresa = verFuncionarios ? empresa : { ...empresa, salario: null, valorVt: null };
  const oculto = (v: unknown) => (v ? "•••" : null);
  const filhosVisiveis = (lista: Array<{ cpf: string | null }>) => lista.map((f) => ({ ...f, cpf: oculto(f.cpf) }));
  const dadosVisiveis = verFuncionarios ? dados : {
    ...dados, cpf: oculto(dados.cpf), pixChave: oculto(dados.pixChave),
    filhos: Array.isArray(dados.filhos) ? filhosVisiveis(dados.filhos) : dados.filhos,
  };
  const mudancas = compararCom ? diferencas(dados, compararCom as unknown as Record<string, unknown>) : [];
  const listaFilhos = Array.isArray(dados.filhos) ? dados.filhos : [];
  const novos = compararCom ? filhosNovos(listaFilhos, compararCom.dependentes) : [];
  const alterados = compararCom ? filhosAlterados(listaFilhos, compararCom.dependentes) : [];
  // Sem ver Funcionários, nem o valor atual nem o novo de CPF/PIX aparecem.
  const SENSIVEIS = new Set(["cpf", "pixChave"]);
  const empresas = await prisma.company.findMany({
    where: { isActive: true }, orderBy: { tradeName: "asc" },
    select: { id: true, tradeName: true, legalName: true, cnpj: true },
  });
  return response.json({
    ...resto,
    dadosEmpresa,
    salarioOculto: !verFuncionarios,
    dados: dadosVisiveis,
    funcionario: employee ? { id: employee.id, nome: [employee.firstName, employee.lastName].join(" "), isActive: employee.isActive } : null,
    diferencas: verFuncionarios ? mudancas : mudancas.map((m) => ({
      ...m, atual: m.atual == null ? null : "•••", novo: SENSIVEIS.has(m.campo) ? "•••" : m.novo,
    })),
    filhosNovos: verFuncionarios ? novos : filhosVisiveis(novos),
    filhosAlterados: verFuncionarios ? alterados : alterados.map((f) => ({
      ...f, ...(f.cpf ? { cpf: { atual: oculto(f.cpf.atual), novo: "•••" } } : {}),
    })),
    falta: faltaParaFinalizar(dados, ficha.arquivos.map((a) => a.tipo), ficha.tipo === "ADMISSAO"),
    empresas,
    opcoes: { estadosCivis: ESTADOS_CIVIS, racasCores: RACAS_CORES, escolaridades: ESCOLARIDADES, ufs: UFS, tiposArquivo: TIPOS_ARQUIVO, rotulos: ROTULOS },
  });
});

async function abertaOu404(id: string, response: Response) {
  const ficha = await prisma.fichaCadastral.findUnique({ where: { id } });
  if (!ficha) { response.status(404).json({ message: "Ficha não encontrada." }); return null; }
  if (!ABERTAS.includes(ficha.status)) {
    response.status(409).json({ message: ficha.status === "CONCLUIDA" ? "Ficha já concluída." : "Ficha cancelada." });
    return null;
  }
  return ficha;
}

// ─── Parte da empresa ───────────────────────────────────────────────────────────
fichaCadastralRouter.put("/:id/empresa", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await prisma.fichaCadastral.findUnique({ where: { id: request.params.id } });
  if (!ficha) return response.status(404).json({ message: "Ficha não encontrada." });
  if (ficha.status === "CANCELADA") return response.status(409).json({ message: "Ficha cancelada." });
  const lido = lerDadosEmpresa((request.body ?? {}) as Record<string, unknown>);
  if ("erro" in lido) return response.status(400).json({ message: lido.erro });
  // Salário só com a permissão de ver Funcionários (mesma regra do cadastro). Sem ela, a tela
  // recebe o salário oculto: o que já estava gravado é mantido, não apagado.
  const anterior = ficha.dadosEmpresa as Partial<DadosEmpresa>;
  let dados = lido.dados;
  if (!(await userHasPermission(user, "employees", "view"))) {
    if (lido.dados.salario != null || lido.dados.valorVt != null) {
      return response.status(403).json({ message: "Exige permissão de ver Funcionários para informar salário ou valor do VT." });
    }
    dados = { ...lido.dados, salario: anterior.salario ?? null, valorVt: anterior.valorVt ?? null };
  }
  await prisma.fichaCadastral.update({ where: { id: ficha.id }, data: { dadosEmpresa: dados as Prisma.InputJsonValue } });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_EMPRESA", entity: "FichaCadastral", entityId: ficha.id, previousValue: anterior, newValue: dados, ...auditoria(request) });
  return response.json({ ok: true });
});

// ─── Novo link (o anterior para de funcionar) ───────────────────────────────────
fichaCadastralRouter.post("/:id/novo-link", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await abertaOu404(request.params.id, response);
  if (!ficha) return;
  if (ficha.status === "FINALIZADA") return response.status(409).json({ message: "A pessoa já finalizou. Para ela corrigir algo, use \"Devolver para correção\"." });
  const { codigo, hash } = gerarCodigo();
  const atualizada = await prisma.fichaCadastral.update({
    where: { id: ficha.id },
    data: { tokenHash: hash, expiraEm: expiracaoNova(), tentativasErradas: 0, bloqueadoAte: null },
  });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_NOVO_LINK", entity: "FichaCadastral", entityId: ficha.id, ...auditoria(request) });
  return response.json({ id: ficha.id, codigo, expiraEm: atualizada.expiraEm });
});

// ─── Devolver para a pessoa corrigir (o mesmo link volta a abrir) ────────────────
fichaCadastralRouter.post("/:id/devolver", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await abertaOu404(request.params.id, response);
  if (!ficha) return;
  if (ficha.status !== "FINALIZADA") return response.status(409).json({ message: "Só dá para devolver uma ficha que a pessoa já finalizou." });
  const motivo = String((request.body as Record<string, unknown>)?.motivo ?? "").trim().slice(0, 500);
  if (motivo.length < 3) return response.status(400).json({ message: "Escreva o que a pessoa precisa corrigir." });
  const expiraEm = new Date(Math.max(ficha.expiraEm.getTime(), expiracaoNova().getTime()));
  await prisma.fichaCadastral.update({ where: { id: ficha.id }, data: { status: "PREENCHENDO", motivoDevolucao: motivo, finalizadaEm: null, expiraEm } });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_DEVOLVIDA", entity: "FichaCadastral", entityId: ficha.id, newValue: { motivo }, ...auditoria(request) });
  return response.json({ ok: true, expiraEm });
});

// ─── Cancelar ───────────────────────────────────────────────────────────────────
fichaCadastralRouter.post("/:id/cancelar", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await abertaOu404(request.params.id, response);
  if (!ficha) return;
  await prisma.fichaCadastral.update({ where: { id: ficha.id }, data: { status: "CANCELADA", canceladaEm: new Date() } });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_CANCELADA", entity: "FichaCadastral", entityId: ficha.id, ...auditoria(request) });
  return response.json({ ok: true });
});

// ─── Concluir: cria o funcionário ou grava a atualização ────────────────────────
fichaCadastralRouter.post("/:id/concluir", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await prisma.fichaCadastral.findUnique({ where: { id: request.params.id } });
  if (!ficha) return response.status(404).json({ message: "Ficha não encontrada." });
  if (ficha.status !== "FINALIZADA") return response.status(409).json({ message: "Só dá para concluir uma ficha que a pessoa já finalizou." });
  const acao = ficha.tipo === "ADMISSAO" ? "create" : "edit";
  if (!(await userHasPermission(user, "employees", acao))) {
    return response.status(403).json({ message: ficha.tipo === "ADMISSAO" ? "Exige permissão de criar Funcionários." : "Exige permissão de editar Funcionários." });
  }
  const campos = (request.body as Record<string, unknown>)?.campos;
  // Atualização só grava o que o RH marcou: sem lista, nada passa — trocar PIX ou CPF de quem já
  // recebe exige escolha explícita (link vazado + "Concluir" no automático desviaria pagamento).
  if (ficha.tipo === "ATUALIZACAO" && !Array.isArray(campos)) return response.status(400).json({ message: "Marque o que deve ser gravado no cadastro." });
  try {
    if (ficha.tipo === "ADMISSAO") {
      const { funcionario } = await concluirAdmissao(ficha, user.id);
      await auditLog({ userId: user.id, action: "CREATE_EMPLOYEE", entity: "Employee", entityId: funcionario.id, newValue: { ...mascararDadosSensiveis(funcionario), origem: `FichaCadastral ${ficha.id}` }, ...auditoria(request) });
      return response.json({ ok: true, employeeId: funcionario.id });
    }
    const escolhidos = (campos as unknown[]).map(String);
    const { antes, funcionario, filhosIncluidos } = await concluirAtualizacao(ficha, user.id, escolhidos);
    await auditLog({ userId: user.id, action: "UPDATE_EMPLOYEE", entity: "Employee", entityId: funcionario.id, previousValue: mascararDadosSensiveis(antes), newValue: { ...mascararDadosSensiveis(funcionario), origem: `FichaCadastral ${ficha.id}`, filhosIncluidos }, ...auditoria(request) });
    return response.json({ ok: true, employeeId: funcionario.id });
  } catch (error) {
    if (error instanceof ErroConclusao) return response.status(400).json({ message: error.message });
    throw error;
  }
});

// ─── Arquivo (foto/PDF) ─────────────────────────────────────────────────────────
fichaCadastralRouter.get("/:id/arquivos/:arquivoId", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const arquivo = await prisma.fichaCadastralArquivo.findFirst({ where: { id: request.params.arquivoId, fichaId: request.params.id } });
  if (!arquivo) return response.status(404).json({ message: "Arquivo não encontrado." });
  // Documento pessoal (RG, CPF, certidão): quem abriu fica registrado (LGPD).
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_ARQUIVO_ABERTO", entity: "FichaCadastralArquivo", entityId: arquivo.id, newValue: { fichaId: arquivo.fichaId, tipo: arquivo.tipo }, ...auditoria(request) });
  enviarArquivo(response, arquivo);
});
