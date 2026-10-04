// Fichas cadastrais do lado do RH: gerar o link, acompanhar, conferir, completar a parte da
// empresa e concluir. Módulo de permissão próprio ("employee-forms"); concluir também exige
// poder criar (admissão) ou editar (atualização) Funcionários, porque grava no cadastro.
import { Router, type Request, type Response } from "express";
import { Prisma, type FichaCadastralStatus } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { mascararDadosSensiveis } from "./auditoria-mascara.js";
import { nomeProprio } from "../../shared/utils/nome-proprio.js";
import {
  ESCOLARIDADES, ESTADOS_CIVIS, RACAS_CORES, ROTULOS, TIPOS_ARQUIVO, UFS,
  dadosDoFuncionario, diferencas, ehFilho, faltaParaFinalizar, filhosAlterados, filhosNovos, lerDadosEmpresa, lerDadosPessoa,
  type DadosEmpresa, type DadosPessoa,
} from "./ficha-cadastral-campos.js";
import { expiracaoNova, gerarCodigo } from "./ficha-cadastral-acesso.js";
import { ConflitoConclusao, ErroConclusao, concluirAdmissao, concluirAtualizacao } from "./ficha-cadastral-concluir.js";
import { enviarArquivo } from "./ficha-cadastral-arquivo.js";

export const fichaCadastralRouter = Router();

const ABERTAS: FichaCadastralStatus[] = ["ENVIADA", "PREENCHENDO", "FINALIZADA"];
const SITUACOES = new Set<string>(["ENVIADA", "PREENCHENDO", "FINALIZADA", "CONCLUIDA", "CANCELADA"]);
const MUDOU = "A ficha mudou de situação enquanto você estava nela. Recarregue a tela.";
// Sem ver Funcionários, nem o valor atual nem o novo destes campos aparecem.
const SENSIVEIS = new Set(["cpf", "pixChave", "rg", "pis", "tituloEleitor", "ctpsNumero"]);
const versaoDe = (f: { updatedAt: Date }) => f.updatedAt.toISOString();
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

type FuncionarioDaFicha = Parameters<typeof empresaDoFuncionario>[0] & { id: string; firstName: string; lastName: string };

type FilhoDaFicha = { id: string; nome: string; dataNascimento: Date | null; cpf: string | null; parentesco: string | null };

// Ficha de ATUALIZAÇÃO de um funcionário: já abre com o que o cadastro tem.
function novaAtualizacao(e: FuncionarioDaFicha, filhos: FilhoDaFicha[], usuarioId: string) {
  const { codigo, hash } = gerarCodigo();
  const data: Prisma.FichaCadastralUncheckedCreateInput = {
    tipo: "ATUALIZACAO", tokenHash: hash, expiraEm: expiracaoNova(), employeeId: e.id,
    nomeReferencia: [e.firstName, e.lastName].filter(Boolean).join(" "),
    dados: dadosDoFuncionario(e as unknown as Record<string, unknown>, filhos.filter((f) => ehFilho(f.parentesco))) as Prisma.InputJsonValue,
    dadosEmpresa: empresaDoFuncionario(e) as Prisma.InputJsonValue,
    createdById: usuarioId,
  };
  return { data, codigo };
}

async function criarAtualizacao(e: FuncionarioDaFicha, filhos: FilhoDaFicha[], usuarioId: string) {
  const { data, codigo } = novaAtualizacao(e, filhos, usuarioId);
  return { ficha: await prisma.fichaCadastral.create({ data }), codigo };
}

const TEMPO_LOTE_MS = 60_000;

// ─── ATUALIZAÇÃO EM LOTE (todos os ativos) ──────────────────────────────────────
// Gera um link para cada funcionário ativo que ainda não tem ficha aberta. Os códigos só existem
// nesta resposta (o banco guarda o hash): a tela mostra a lista para mandar pelo WhatsApp.
// Gerar link (ficha nova, lote, novo link) exige, além de Fichas, ver Funcionários (decisão do
// dono em 04/10/2026): quem gera o link de alguém pode, com a data de nascimento, ler a ficha toda.
async function podeGerarLink(user: SessionUser, response: Response): Promise<boolean> {
  if (await userHasPermission(user, "employees", "view")) return true;
  response.status(403).json({ message: "Gerar link de ficha exige também a permissão de ver Funcionários." });
  return false;
}

type LoteCriada = { fichaId: string; employeeId: string; nome: string; codigo: string; expiraEm: Date; celular: string | null };
type LoteJaAberta = { fichaId: string; employeeId: string; nome: string };

// Tudo ou nada: se uma criação falhar, nenhuma ficha fica aberta sem o código ter chegado à tela.
// A trava impede dois lotes simultâneos de abrirem duas fichas para a mesma pessoa.
function gerarLote(usuarioId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ficha-cadastral-lote'))`;
    const ativos = await tx.employee.findMany({
      where: { deletedAt: null, isActive: true }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    const ids = ativos.map((e) => e.id);
    const abertas = await tx.fichaCadastral.findMany({
      where: { employeeId: { in: ids }, status: { in: ABERTAS } }, select: { id: true, employeeId: true },
    });
    const comFicha = new Map(abertas.map((f) => [f.employeeId, f.id]));
    const dependentes = await tx.employeeDependente.findMany({
      where: { employeeId: { in: ids } }, select: { id: true, employeeId: true, nome: true, dataNascimento: true, cpf: true, parentesco: true },
    });
    const filhosPor = new Map<string, FilhoDaFicha[]>();
    for (const d of dependentes) filhosPor.set(d.employeeId, [...(filhosPor.get(d.employeeId) ?? []), d]);
    const criadas: LoteCriada[] = [];
    const jaAbertas: LoteJaAberta[] = [];
    for (const e of ativos) {
      const nome = [e.firstName, e.lastName].filter(Boolean).join(" ");
      const aberta = comFicha.get(e.id);
      if (aberta) { jaAbertas.push({ fichaId: aberta, employeeId: e.id, nome }); continue; }
      const { data, codigo } = novaAtualizacao(e, filhosPor.get(e.id) ?? [], usuarioId);
      const ficha = await tx.fichaCadastral.create({ data });
      criadas.push({ fichaId: ficha.id, employeeId: e.id, nome, codigo, expiraEm: ficha.expiraEm, celular: e.phone });
    }
    return { criadas, jaAbertas };
  }, { timeout: TEMPO_LOTE_MS, maxWait: TEMPO_LOTE_MS });
}

fichaCadastralRouter.post("/lote", async (request, response) => {
  const user = await usuario(request, response);
  if (!user || !(await podeGerarLink(user, response))) return;
  let resultado: { criadas: LoteCriada[]; jaAbertas: LoteJaAberta[] };
  try {
    resultado = await gerarLote(user.id);
  } catch (e) {
    console.error("[ficha-cadastral] lote falhou", e);
    return response.status(500).json({ message: "Não foi possível gerar os links. Nenhuma ficha foi criada; tente de novo." });
  }
  const { criadas, jaAbertas } = resultado;
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_LOTE", entity: "FichaCadastral", newValue: { criadas: criadas.length, jaAbertas: jaAbertas.length }, ...auditoria(request) });
  response.setHeader("Cache-Control", "no-store");
  return response.status(201).json({ criadas, jaAbertas });
});

// ─── CRIAR (gera o link) ────────────────────────────────────────────────────────
fichaCadastralRouter.post("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user || !(await podeGerarLink(user, response))) return;
  const b = (request.body ?? {}) as Record<string, unknown>;
  const tipo = b.tipo === "ATUALIZACAO" ? "ATUALIZACAO" : b.tipo === "ADMISSAO" ? "ADMISSAO" : null;
  if (!tipo) return response.status(400).json({ message: "Escolha admissão ou atualização." });

  const nomeReferencia = String(b.nomeReferencia ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (tipo === "ATUALIZACAO") {
    const e = await prisma.employee.findFirst({ where: { id: String(b.employeeId ?? ""), deletedAt: null } });
    if (!e) return response.status(404).json({ message: "Funcionário não encontrado." });
    const aberta = await prisma.fichaCadastral.findFirst({ where: { employeeId: e.id, status: { in: ABERTAS } }, select: { id: true } });
    if (aberta) return response.status(409).json({ message: `Já existe uma ficha aberta para ${e.firstName}. Use "Gerar novo link" nela.`, fichaId: aberta.id });
    const filhos = await prisma.employeeDependente.findMany({
      where: { employeeId: e.id }, select: { id: true, nome: true, dataNascimento: true, cpf: true, parentesco: true },
    });
    const { ficha, codigo } = await criarAtualizacao(e, filhos, user.id);
    await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_CRIADA", entity: "FichaCadastral", entityId: ficha.id, newValue: { tipo, nomeReferencia: ficha.nomeReferencia, employeeId: e.id }, ...auditoria(request) });
    return response.status(201).json({ id: ficha.id, codigo, expiraEm: ficha.expiraEm });
  }
  if (nomeReferencia.length < 2) return response.status(400).json({ message: "Informe o nome da pessoa." });

  const { codigo, hash } = gerarCodigo();
  const ficha = await prisma.fichaCadastral.create({
    data: { tipo, tokenHash: hash, expiraEm: expiracaoNova(), nomeReferencia, createdById: user.id },
  });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_CRIADA", entity: "FichaCadastral", entityId: ficha.id, newValue: { tipo, nomeReferencia }, ...auditoria(request) });
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
      employee: { include: { dependentes: { select: { id: true, nome: true, dataNascimento: true, cpf: true, parentesco: true } } } },
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
  // Sem ver Funcionários: CPF, PIX e os números de documento ficam ocultos — a mesma regra das
  // fotos (decisão do dono em 04/10/2026: o número do RG não pode valer menos que a foto dele).
  const dadosVisiveis = verFuncionarios ? dados : {
    ...dados, ...Object.fromEntries([...SENSIVEIS].map((c) => [c, oculto(dados[c])])),
    filhos: Array.isArray(dados.filhos) ? filhosVisiveis(dados.filhos) : dados.filhos,
  };
  const mudancas = compararCom ? diferencas(dados, compararCom as unknown as Record<string, unknown>) : [];
  const listaFilhos = Array.isArray(dados.filhos) ? dados.filhos : [];
  const filhosDoCadastro = compararCom ? compararCom.dependentes.filter((d) => ehFilho(d.parentesco)) : [];
  const novos = compararCom ? filhosNovos(listaFilhos, filhosDoCadastro) : [];
  const alterados = compararCom ? filhosAlterados(listaFilhos, filhosDoCadastro) : [];
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

// ─── Correções vindas da leitura das fotos dos documentos ──────────────────────
// O RH conferiu a leitura e aceitou trocar o que a pessoa digitou pelo que está no documento.
// Lista fechada de campos que dá para ler de documento; só troca, nunca apaga (data de
// nascimento e CPF protegem o link). CPF e documentos exigem ver Funcionários.
const CORRIGIVEIS = new Set([
  "nomeCompleto", "nomeMae", "nomePai", "dataNascimento", "cpf", "rg", "rgOrgaoEmissor", "pis",
  "tituloEleitor", "tituloZona", "tituloSecao", "ctpsNumero", "ctpsSerie", "cep",
]);
const NOMES = new Set(["nomeCompleto", "nomeMae", "nomePai"]);

fichaCadastralRouter.put("/:id/correcoes", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  if (!(await userHasPermission(user, "employees", "view"))) {
    return response.status(403).json({ message: "Exige permissão de ver Funcionários." });
  }
  const ficha = await prisma.fichaCadastral.findUnique({ where: { id: request.params.id } });
  if (!ficha) return response.status(404).json({ message: "Ficha não encontrada." });
  if (ficha.status !== "FINALIZADA") return response.status(409).json({ message: "Só dá para corrigir uma ficha que a pessoa já enviou." });
  const valores = (request.body as Record<string, unknown>)?.valores;
  if (!valores || typeof valores !== "object" || Array.isArray(valores)) return response.status(400).json({ message: "Nada para corrigir." });
  const entrada = Object.fromEntries(Object.entries(valores as Record<string, unknown>).filter(([c]) => CORRIGIVEIS.has(c)));
  if (Object.keys(entrada).length === 0) return response.status(400).json({ message: "Nada para corrigir." });
  if (Object.values(entrada).some((v) => v == null || String(v).trim() === "")) {
    return response.status(400).json({ message: "A correção não pode deixar campo em branco." });
  }
  const lido = lerDadosPessoa(entrada);
  if ("erro" in lido) return response.status(400).json({ message: lido.erro });
  const corrigido: DadosPessoa = { ...lido.dados };
  for (const c of NOMES) if (typeof corrigido[c] === "string") corrigido[c] = nomeProprio(corrigido[c] as string);
  const anterior = ficha.dados as DadosPessoa;
  // Só grava se a ficha ainda estiver como foi lida (devolvida ou alterada no meio, não sobrescreve).
  const gravada = await prisma.fichaCadastral.updateMany({
    where: { id: ficha.id, status: "FINALIZADA", updatedAt: ficha.updatedAt },
    data: { dados: { ...anterior, ...corrigido } as Prisma.InputJsonValue },
  });
  if (gravada.count === 0) return response.status(409).json({ message: "A ficha mudou enquanto você conferia. Abra de novo e leia os documentos outra vez." });
  const antes = Object.fromEntries(Object.keys(corrigido).map((c) => [c, anterior[c] ?? null]));
  await auditLog({
    userId: user.id, action: "FICHA_CADASTRAL_CORRIGIDA_PELO_DOCUMENTO", entity: "FichaCadastral", entityId: ficha.id,
    previousValue: mascararDadosSensiveis(antes), newValue: mascararDadosSensiveis(corrigido), ...auditoria(request),
  });
  const atual = await prisma.fichaCadastral.findUnique({ where: { id: ficha.id }, select: { updatedAt: true } });
  return response.json({ ok: true, corrigidos: Object.keys(corrigido), versao: atual ? versaoDe(atual) : null });
});

// ─── Parte da empresa ───────────────────────────────────────────────────────────
fichaCadastralRouter.put("/:id/empresa", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await prisma.fichaCadastral.findUnique({ where: { id: request.params.id } });
  if (!ficha) return response.status(404).json({ message: "Ficha não encontrada." });
  if (!ABERTAS.includes(ficha.status)) return response.status(409).json({ message: "Ficha já concluída ou cancelada: a parte da empresa não muda mais." });
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
  const gravada = await prisma.fichaCadastral.updateMany({ where: { id: ficha.id, status: { in: ABERTAS } }, data: { dadosEmpresa: dados as Prisma.InputJsonValue } });
  if (gravada.count === 0) return response.status(409).json({ message: MUDOU });
  const salva = await prisma.fichaCadastral.findUnique({ where: { id: ficha.id }, select: { updatedAt: true } });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_EMPRESA", entity: "FichaCadastral", entityId: ficha.id, previousValue: anterior, newValue: dados, ...auditoria(request) });
  return response.json({ ok: true, versao: salva ? versaoDe(salva) : null });
});

// ─── Novo link (o anterior para de funcionar) ───────────────────────────────────
fichaCadastralRouter.post("/:id/novo-link", async (request, response) => {
  const user = await usuario(request, response);
  if (!user || !(await podeGerarLink(user, response))) return;
  const ficha = await abertaOu404(request.params.id, response);
  if (!ficha) return;
  if (ficha.status === "FINALIZADA") return response.status(409).json({ message: "A pessoa já finalizou. Para ela corrigir algo, use \"Devolver para correção\"." });
  const { codigo, hash } = gerarCodigo();
  const expiraEm = expiracaoNova();
  const r = await prisma.fichaCadastral.updateMany({
    where: { id: ficha.id, status: { in: ["ENVIADA", "PREENCHENDO"] } },
    data: { tokenHash: hash, expiraEm, tentativasErradas: 0, bloqueadoAte: null },
  });
  if (r.count === 0) return response.status(409).json({ message: MUDOU });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_NOVO_LINK", entity: "FichaCadastral", entityId: ficha.id, ...auditoria(request) });
  return response.json({ id: ficha.id, codigo, expiraEm });
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
  const r = await prisma.fichaCadastral.updateMany({
    where: { id: ficha.id, status: "FINALIZADA" }, data: { status: "PREENCHENDO", motivoDevolucao: motivo, finalizadaEm: null, expiraEm },
  });
  if (r.count === 0) return response.status(409).json({ message: MUDOU });
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_DEVOLVIDA", entity: "FichaCadastral", entityId: ficha.id, newValue: { motivo }, ...auditoria(request) });
  return response.json({ ok: true, expiraEm });
});

// ─── Cancelar ───────────────────────────────────────────────────────────────────
fichaCadastralRouter.post("/:id/cancelar", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ficha = await abertaOu404(request.params.id, response);
  if (!ficha) return;
  const r = await prisma.fichaCadastral.updateMany({ where: { id: ficha.id, status: { in: ABERTAS } }, data: { status: "CANCELADA", canceladaEm: new Date() } });
  if (r.count === 0) return response.status(409).json({ message: MUDOU });
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
  // Só a versão que o RH conferiu: devolvida e reenviada, ou corrigida, no meio do caminho = outra
  // ficha (um PIX trocado nunca visto iria para o cadastro).
  const versao = (request.body as Record<string, unknown>)?.versao;
  if (typeof versao !== "string" || versao !== versaoDe(ficha)) {
    return response.status(409).json({ message: "A ficha mudou depois que você a abriu (foi devolvida, reenviada ou corrigida). Recarregue e confira de novo." });
  }
  let concluida: { tipo: "ADMISSAO"; funcionario: { id: string } & Record<string, unknown> } | { tipo: "ATUALIZACAO"; r: Awaited<ReturnType<typeof concluirAtualizacao>> };
  try {
    concluida = ficha.tipo === "ADMISSAO"
      ? { tipo: "ADMISSAO", funcionario: (await concluirAdmissao(ficha, user.id)).funcionario }
      : { tipo: "ATUALIZACAO", r: await concluirAtualizacao(ficha, user.id, (campos as unknown[]).map(String)) };
  } catch (error) {
    if (error instanceof ConflitoConclusao) return response.status(409).json({ message: error.message });
    if (error instanceof ErroConclusao) return response.status(400).json({ message: error.message });
    console.error("[ficha-cadastral] concluir falhou", error);
    return response.status(500).json({ message: "Não foi possível concluir. Nada foi gravado; tente de novo." });
  }
  // Já gravado: falha na auditoria não pode virar "nada foi gravado" (o RH repetiria e veria
  // "já concluída"). Registra o erro e responde o que aconteceu.
  try {
    if (concluida.tipo === "ADMISSAO") {
      const { funcionario } = concluida;
      await auditLog({ userId: user.id, action: "CREATE_EMPLOYEE", entity: "Employee", entityId: funcionario.id, newValue: { ...mascararDadosSensiveis(funcionario), origem: `FichaCadastral ${ficha.id}` }, ...auditoria(request) });
      return response.json({ ok: true, employeeId: funcionario.id });
    }
    const { antes, funcionario, filhosIncluidos, filhosCorrigidos } = concluida.r;
    await auditLog({
      userId: user.id, action: "UPDATE_EMPLOYEE", entity: "Employee", entityId: funcionario.id, previousValue: mascararDadosSensiveis(antes),
      newValue: {
        ...mascararDadosSensiveis(funcionario), origem: `FichaCadastral ${ficha.id}`,
        // Filhos: quem entrou e o que mudou em quem já estava (CPF mascarado, como no resto).
        filhosIncluidos: filhosIncluidos.map((f) => ({ nome: f.nome, dataNascimento: f.dataNascimento, cpf: f.cpf ? "***" : null })),
        filhosCorrigidos: filhosCorrigidos.map((c) => ({
          dependenteId: c.dependenteId, nome: c.nome, nomeNovo: c.nomeNovo ?? null, dataNascimento: c.dataNascimento ?? null, cpfAlterado: Boolean(c.cpf),
        })),
      },
      ...auditoria(request),
    });
    return response.json({ ok: true, employeeId: funcionario.id });
  } catch (error) {
    console.error("[ficha-cadastral] concluída, mas a auditoria falhou", error);
    const employeeId = concluida.tipo === "ADMISSAO" ? concluida.funcionario.id : concluida.r.funcionario.id;
    return response.json({ ok: true, employeeId });
  }
});

// ─── Arquivo (foto/PDF) ─────────────────────────────────────────────────────────
fichaCadastralRouter.get("/:id/arquivos/:arquivoId", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  // Foto de documento mostra CPF, RG e o rosto: além de Fichas, exige ver Funcionários (decisão do
  // dono em 04/10/2026 — a mesma regra que oculta CPF e PIX no texto da ficha).
  if (!(await userHasPermission(user, "employees", "view"))) {
    return response.status(403).json({ message: "Abrir fotos e documentos exige também a permissão de ver Funcionários." });
  }
  const arquivo = await prisma.fichaCadastralArquivo.findFirst({ where: { id: request.params.arquivoId, fichaId: request.params.id } });
  if (!arquivo) return response.status(404).json({ message: "Arquivo não encontrado." });
  // Documento pessoal (RG, CPF, certidão): quem abriu fica registrado (LGPD).
  await auditLog({ userId: user.id, action: "FICHA_CADASTRAL_ARQUIVO_ABERTO", entity: "FichaCadastralArquivo", entityId: arquivo.id, newValue: { fichaId: arquivo.fichaId, tipo: arquivo.tipo }, ...auditoria(request) });
  enviarArquivo(response, arquivo);
});
