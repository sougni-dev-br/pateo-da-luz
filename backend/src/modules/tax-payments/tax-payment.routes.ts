import crypto from "node:crypto";
import fs from "node:fs";
import { Router } from "express";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../cmv-real/period-locked-error.js";
import multer from "multer";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { buildExistingDedupKeys, previewTaxImport } from "./tax-payment-import.service.js";
import { categoriaIdPorNome, sugerirCategoriaImposto } from "./categoria-imposto.js";
import { userHasPermission } from "../security/menu-permissions.js";
import type { SessionUser } from "../security/security-utils.js";
import { montarPanorama } from "./tax-payment-panorama.js";
import { descricaoDosItens, lerNumeroDoDocumento, lerQuantidadeDeTrabalhadores, normalizarItens, type ItemGuia } from "./tax-payment-items.js";
import { aplicarCatalogoDeCodigos, guardarCodigosNovos } from "./tax-code-catalog.js";
import { limparUploadsAntigos, PASTA_UPLOADS_IMPOSTOS } from "./tax-payment-uploads.js";
import { lerFuncionarioDaGuia } from "./tax-payment-employee.js";
import { dataDePagamentoPlausivel, diaIso, hojeBrasilia, lerData, observacoesDaBaixa, observacoesDoEstorno, parseValorGuia, resolverUploadImportacao, statusDaGuia, statusDeGuiaEmAberto } from "./tax-payment-rules.js";

export const taxPaymentRouter = Router();

// ─── upload multer ────────────────────────────────────────────────────────────
const upload = multer({
  dest: PASTA_UPLOADS_IMPOSTOS,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(_req, file, cb) {
    const ok =
      file.mimetype.includes("spreadsheetml") ||
      file.mimetype.includes("excel") ||
      file.mimetype === "application/octet-stream" ||
      file.originalname.match(/\.(xlsx|xls)$/i) != null;
    cb(null, ok);
  },
});

// ─── helpers ──────────────────────────────────────────────────────────────────
const PASTA_UPLOADS = PASTA_UPLOADS_IMPOSTOS;

// Identificador que a tela gera uma vez por modal de lançamento (UUID): torna o POST repetível sem lançar a guia duas vezes.
const ID_DO_CLIENTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// O corpo reenviado descreve a guia que já existe? Compara o que identifica o lançamento (tipo, número, vencimento,
// competência e valor); campos que o corpo não traz não entram na comparação.
function ehOMesmoLancamento(
  guia: { documentType: string; documentNumber: string | null; dueDate: Date; competenceDate: Date | null; amount: unknown },
  corpo: Record<string, unknown>,
): boolean {
  if (typeof corpo.documentType === "string" && corpo.documentType.trim() !== guia.documentType) return false;
  if (corpo.documentNumber !== undefined) {
    const numero = lerNumeroDoDocumento(corpo.documentNumber);
    if (!numero.ok || (numero.valor ?? null) !== (guia.documentNumber ?? null)) return false;
  }
  if (corpo.dueDate !== undefined) {
    const v = lerData(corpo.dueDate);
    if (!v.ok || diaIso(v.data) !== diaIso(guia.dueDate)) return false;
  }
  if (corpo.competenceDate !== undefined) {
    const c = lerData(corpo.competenceDate);
    if (!c.ok || diaIso(c.data) !== diaIso(guia.competenceDate)) return false;
  }
  if (corpo.items !== undefined) {
    const lidos = normalizarItens(corpo.items);
    if (!lidos.ok || Math.round(lidos.total * 100) !== Math.round(Number(guia.amount) * 100)) return false;
  }
  return true;
}

// Violação da chave primária (e não do índice do número do documento): a mesma guia criada duas vezes com o mesmo id.
function ehIdRepetido(error: unknown): boolean {
  if (!ehNumeroRepetido(error)) return false;
  const alvo = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(alvo) ? alvo.includes("id") : typeof alvo === "string" && /(^|_)(id|pkey)$/.test(alvo);
}

function categoriasAtivas() {
  return prisma.dRECategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, dreGroup: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

function categoriaSugerida(
  categorias: ReadonlyArray<{ id: string; name: string }>,
  documentType: unknown,
  description: unknown
) {
  const nome = sugerirCategoriaImposto(
    typeof documentType === "string" ? documentType : null,
    typeof description === "string" ? description : null
  );
  const dreCategoryId = categoriaIdPorNome(categorias, nome);
  return { dreCategoryId, nome: dreCategoryId ? nome : null };
}

type TaxPaymentRow = {
  id: string;
  companyId: string | null;
  cnpj: string | null;
  legalName: string | null;
  tradeName: string | null;
  documentType: string;
  description: string | null;
  competenceDate: Date | null;
  dueDate: Date;
  amount: string;
  paymentDate: Date | null;
  paidAmount: string | null;
  status: string;
  comments: string | null;
  source: string;
  importBatchId: string | null;
  dreCategoryId: string | null;
  dreCategoryName: string | null;
  employeeName: string | null;
  itemsCount: number;
  createdById: string;
  updatedById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── GET /tax-payments ────────────────────────────────────────────────────────
// Ordem por urgência: o que ainda falta pagar vem primeiro (vencimento mais próximo no topo);
// pagas e canceladas vão depois, da mais recente para a mais antiga.
const SITUACOES_ACEITAS = new Set(["PENDING", "PAID", "OVERDUE", "CANCELED", "WITHOUT_RECEIPT"]);
const DIA_DO_FILTRO = /^\d{4}-\d{2}-\d{2}$/;
const PAGINA_MAXIMA = 100_000;

// Filtro vindo da URL: só texto simples vale (`?a=1&a=2` chega como lista e `?a[x]=1` como objeto).
function textoDoFiltro(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

taxPaymentRouter.get("/", async (request, response) => {
  const q = request.query as Record<string, unknown>;
  const companyId = textoDoFiltro(q.companyId);
  const cnpj = textoDoFiltro(q.cnpj);
  const documentType = textoDoFiltro(q.documentType);
  const status = textoDoFiltro(q.status);
  const competenceStart = textoDoFiltro(q.competenceStart);
  const competenceEnd = textoDoFiltro(q.competenceEnd);
  const dueStart = textoDoFiltro(q.dueStart);
  const dueEnd = textoDoFiltro(q.dueEnd);
  const paymentStart = textoDoFiltro(q.paymentStart);
  const paymentEnd = textoDoFiltro(q.paymentEnd);
  const search = textoDoFiltro(q.search);
  const dreCategoryId = textoDoFiltro(q.dreCategoryId);
  const withoutCompetence = textoDoFiltro(q.withoutCompetence);
  const excludeCanceled = textoDoFiltro(q.excludeCanceled);
  const page = textoDoFiltro(q.page) || "1";
  const pageSize = textoDoFiltro(q.pageSize) || "50";

  if (status && !SITUACOES_ACEITAS.has(status)) return response.status(400).json({ message: "Situação inválida." });
  const datas = { competenceStart, competenceEnd, dueStart, dueEnd, paymentStart, paymentEnd };
  for (const [campo, valor] of Object.entries(datas)) {
    if (valor && (!DIA_DO_FILTRO.test(valor) || Number.isNaN(new Date(valor).getTime()))) {
      return response.status(400).json({ message: `Data inválida em ${campo} (use AAAA-MM-DD).` });
    }
  }

  const pageNum = Math.min(PAGINA_MAXIMA, Math.max(1, parseInt(page, 10) || 1));
  const size = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * size;

  const conditions: string[] = [`tp."deletedAt" IS NULL`];
  const params: unknown[] = [];

  function addParam(val: unknown) {
    params.push(val);
    return `$${params.length}`;
  }

  if (companyId) conditions.push(`tp."companyId" = ${addParam(companyId)}`);
  if (cnpj) conditions.push(`tp."cnpj" = ${addParam(cnpj.replace(/\D/g, ""))}`);
  // Tipo exato (sem 'contém'): filtrar "DARF" não pode trazer "DARF IR".
  if (documentType) conditions.push(`LOWER(tp."documentType") = LOWER(${addParam(documentType)})`);
  // "none": guias sem categoria (a célula "Sem categoria" da grade).
  if (dreCategoryId === "none") conditions.push(`tp."dreCategoryId" IS NULL`);
  else if (dreCategoryId) conditions.push(`tp."dreCategoryId" = ${addParam(dreCategoryId)}`);

  // Mesma regra de situação de Contas a Pagar e do selo da lista: cancelada, paga, vencida (antes de
  // hoje, em Brasília) ou a vencer. O status gravado só decide o cancelamento; "vencido" envelhece sozinho.
  // hoje vem de Intl (AAAA-MM-DD), por isso pode ser interpolado.
  const hoje = hojeBrasilia();
  if (status) {
    if (status === "OVERDUE") {
      conditions.push(`tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" < '${hoje}'::timestamp`);
    } else if (status === "PENDING") {
      conditions.push(`tp."status" <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= '${hoje}'::timestamp`);
    } else if (status === "PAID") {
      conditions.push(`tp."status" <> 'CANCELED' AND tp."paymentDate" IS NOT NULL`);
    } else {
      conditions.push(`tp."status" = ${addParam(status)}`);
    }
  }

  // Mesma conta do contador do painel: guia cancelada não conta como "sem competência" (só aparece se pedirem Canceladas).
  if (withoutCompetence === "true") {
    conditions.push(`tp."competenceDate" IS NULL`);
    if (status !== "CANCELED") conditions.push(`tp."status" <> 'CANCELED'`);
  }
  // Clique numa célula da grade de cobertura: a grade não conta guia cancelada, a lista também não pode trazer.
  if (excludeCanceled === "true" && status !== "CANCELED" && withoutCompetence !== "true") conditions.push(`tp."status" <> 'CANCELED'`);
  if (competenceStart) conditions.push(`tp."competenceDate" >= ${addParam(new Date(competenceStart))}`);
  if (competenceEnd) conditions.push(`tp."competenceDate" <= ${addParam(new Date(competenceEnd + "T23:59:59.999Z"))}`);
  if (dueStart) conditions.push(`tp."dueDate" >= ${addParam(new Date(dueStart))}`);
  if (dueEnd) conditions.push(`tp."dueDate" <= ${addParam(new Date(dueEnd + "T23:59:59.999Z"))}`);
  if (paymentStart) conditions.push(`tp."paymentDate" >= ${addParam(new Date(paymentStart))}`);
  if (paymentEnd) conditions.push(`tp."paymentDate" <= ${addParam(new Date(paymentEnd + "T23:59:59.999Z"))}`);

  if (search) {
    // % e _ digitados são texto comum, não curinga.
    const like = addParam(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(tp."legalName" ILIKE ${like} OR tp."tradeName" ILIKE ${like} OR tp."description" ILIKE ${like} OR tp."cnpj" ILIKE ${like} OR tp."documentNumber" ILIKE ${like})`);
  }

  const where = conditions.join(" AND ");

  const [rows, countResult, summary] = await Promise.all([
    prisma.$queryRawUnsafe<TaxPaymentRow[]>(`
      SELECT
        tp.*,
        dc.name AS "dreCategoryName",
        COALESCE(NULLIF(TRIM(e."displayName"), ''), e."firstName" || ' ' || e."lastName") AS "employeeName",
        (SELECT COUNT(*)::int FROM "TaxPaymentItem" ti WHERE ti."taxPaymentId" = tp.id) AS "itemsCount"
      FROM "TaxPayment" tp
      LEFT JOIN "DRECategory" dc ON dc.id = tp."dreCategoryId"
      LEFT JOIN "Employee" e ON e.id = tp."employeeId"
      WHERE ${where}
      ORDER BY
        (tp."paymentDate" IS NOT NULL OR tp."status" = 'CANCELED') ASC,
        CASE WHEN tp."paymentDate" IS NULL AND tp."status" <> 'CANCELED' THEN tp."dueDate" END ASC,
        tp."dueDate" DESC, tp."createdAt" DESC, tp."id"
      LIMIT ${size} OFFSET ${offset}
    `, ...params),
    prisma.$queryRawUnsafe<[{ total: string }]>(`
      SELECT COUNT(*)::text AS total
      FROM "TaxPayment" tp
      WHERE ${where}
    `, ...params),
    prisma.$queryRawUnsafe<Array<{
      total: string;
      paid: string;
      pending: string;
      overdue: string;
      withoutReceipt: string;
    }>>(`
      SELECT
        COALESCE(SUM(CASE WHEN tp.status <> 'CANCELED' THEN tp.amount ELSE 0 END), 0)::text AS total,
        COALESCE(SUM(CASE WHEN tp.status <> 'CANCELED' AND tp."paymentDate" IS NOT NULL THEN tp.amount ELSE 0 END), 0)::text AS paid,
        COALESCE(SUM(CASE WHEN tp.status <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" >= '${hoje}'::timestamp THEN tp.amount ELSE 0 END), 0)::text AS pending,
        COALESCE(SUM(CASE WHEN tp.status <> 'CANCELED' AND tp."paymentDate" IS NULL AND tp."dueDate" < '${hoje}'::timestamp THEN tp.amount ELSE 0 END), 0)::text AS overdue,
        COALESCE(SUM(CASE WHEN tp.status = 'WITHOUT_RECEIPT' THEN tp.amount ELSE 0 END), 0)::text AS "withoutReceipt"
      FROM "TaxPayment" tp
      WHERE ${where}
    `, ...params),
  ]);

  const total = parseInt(countResult[0]?.total ?? "0", 10);

  response.json({
    data: rows,
    pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
    summary: summary[0] ?? { total: "0", paid: "0", pending: "0", overdue: "0", withoutReceipt: "0" },
  });
});

// ─── Categorias do DRE para a tela de impostos ────────────────────────────────
// Ficam aqui (e não só em /dre) porque quem lança guia nem sempre tem acesso ao DRE.
// Precisam vir antes de "/:id", senão o Express trata o nome da rota como id.
// Catálogo de códigos do tipo de guia (o código digitado traz a denominação na tela). Antes de "/:id".
taxPaymentRouter.get("/codigos", async (request, response) => {
  const tipo = typeof request.query.tipo === "string" ? request.query.tipo.trim() : "";
  const codigos = await prisma.taxCodeCatalog.findMany({
    where: tipo ? { documentType: tipo } : {},
    select: { code: true, description: true },
    orderBy: { code: "asc" },
  });
  response.json(codigos ?? []);
});

// Corrige a denominação de um código do catálogo. O primeiro texto digitado para um código vira o oficial e não havia como
// consertar um erro de digitação. Vale para as próximas guias: as já lançadas guardam o texto que tinham. Antes de "/:id".
taxPaymentRouter.put("/codigos", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { documentType, code, description } = request.body as Record<string, unknown>;
  if (typeof documentType !== "string" || !documentType.trim() || typeof code !== "string" || !code.trim()) {
    return response.status(400).json({ message: "Informe o tipo e o código." });
  }
  const texto = typeof description === "string" ? description.trim() : "";
  if (!texto) return response.status(400).json({ message: "Informe a denominação." });
  if (texto.length > 200) return response.status(400).json({ message: "Denominação com mais de 200 caracteres." });

  const atual = await prisma.taxCodeCatalog.findUnique({ where: { documentType_code: { documentType: documentType.trim(), code: code.trim() } } });
  if (!atual) return response.status(404).json({ message: "Esse código não está no catálogo deste tipo de guia." });
  if (atual.description === texto) return response.json({ code: atual.code, description: atual.description });

  const atualizado = await prisma.taxCodeCatalog.update({ where: { id: atual.id }, data: { description: texto } });
  await auditLog({
    userId: user.id,
    action: "UPDATE_TAX_CODE",
    entity: "TaxCodeCatalog",
    entityId: atual.id,
    previousValue: { documentType: atual.documentType, code: atual.code, description: atual.description },
    newValue: { documentType: atual.documentType, code: atual.code, description: atualizado.description },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });
  return response.json({ code: atualizado.code, description: atualizado.description });
});

// Painel da tela: a pagar por faixa de vencimento, guias por situação e meses já lançados.
// Antes de "/:id" pelo mesmo motivo das categorias.
taxPaymentRouter.get("/panorama", async (_request, response) => {
  response.json(await montarPanorama());
});

// Tipos que existem de fato nas guias (a importação de planilha grava o texto livre da coluna, ex.: "RECEITA FEDERAL"):
// a lista de tipos do filtro sai daqui, senão essas guias não seriam alcançáveis pelo filtro de tipo exato.
taxPaymentRouter.get("/tipos", async (_request, response) => {
  const linhas = await prisma.$queryRawUnsafe<Array<{ documentType: string; qtd: number }>>(
    `SELECT TRIM(tp."documentType") AS "documentType", COUNT(*)::int AS "qtd"
       FROM "TaxPayment" tp WHERE tp."deletedAt" IS NULL AND TRIM(tp."documentType") <> ''
      GROUP BY TRIM(tp."documentType") ORDER BY COUNT(*) DESC, TRIM(tp."documentType")`
  );
  response.json(linhas.map((l) => ({ documentType: l.documentType, qtd: Number(l.qtd) })));
});

taxPaymentRouter.get("/categorias-dre", async (_request, response) => {
  response.json(await categoriasAtivas());
});

taxPaymentRouter.get("/categoria-sugerida", async (request, response) => {
  const { documentType, description } = request.query;
  response.json(categoriaSugerida(await categoriasAtivas(), documentType, description));
});

// ─── GET /tax-payments/:id ────────────────────────────────────────────────────
taxPaymentRouter.get("/:id", async (request, response) => {
  const { id } = request.params;
  const row = await prisma.taxPayment.findFirst({
    where: { id, deletedAt: null },
    include: {
      company: { select: { id: true, tradeName: true, legalName: true, cnpj: true } },
      dreCategory: { select: { id: true, name: true, dreGroup: true } },
      employee: { select: { id: true, firstName: true, lastName: true, displayName: true, terminationDate: true } },
      items: { orderBy: { position: "asc" } },
    },
  });
  if (!row) return response.status(404).json({ message: "Lançamento não encontrado." });
  return response.json(row);
});

// ─── POST /tax-payments ───────────────────────────────────────────────────────
// O DRE posiciona o imposto pela competenceDate (nao pela data de pagamento), entao e a
// competencia que precisa respeitar mes travado / periodo de CMV fechado.
async function competenciaBloqueada(
  competence: Date | null,
  contexto: string,
  response: { status: (c: number) => { json: (b: unknown) => void } }
) {
  if (!competence || Number.isNaN(competence.getTime())) return false;
  try {
    await assertPeriodWritableForDate(competence, contexto);
    return false;
  } catch (error) {
    if (!(error instanceof PeriodLockedError)) throw error;
    response.status(400).json({ message: error.message });
    return true;
  }
}
// Mesma guia lançada duas vezes: o número do documento (DAS/DARF) ou o identificador (FGTS) é único por emissão.
// "07.20.26290.7165263-2" e "07202629071652632" são o mesmo número: a comparação (e o índice único do banco) só
// olha letras e dígitos, sem diferenciar caixa.
function chaveDoNumero(numero: string): string {
  return numero.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function guiaComEsteNumero(numero: string, ignorarId?: string) {
  const chave = chaveDoNumero(numero);
  if (!chave) return null;
  const achadas = await prisma.$queryRawUnsafe<Array<{ id: string; documentType: string; competenceDate: Date | null }>>(
    `SELECT "id", "documentType", "competenceDate" FROM "TaxPayment"
      WHERE "deletedAt" IS NULL AND "status" <> 'CANCELED' AND "documentNumber" IS NOT NULL
        AND regexp_replace(upper("documentNumber"), '[^A-Z0-9]', '', 'g') = $1
        ${ignorarId ? `AND "id" <> $2` : ""}
      LIMIT 1`,
    ...(ignorarId ? [chave, ignorarId] : [chave])
  );
  return achadas[0] ?? null;
}

// Duas gravações ao mesmo tempo passam pela checagem acima; quem perde a corrida bate no índice único do banco.
function ehNumeroRepetido(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

const MENSAGEM_NUMERO_REPETIDO = "Já existe uma guia ativa com este número de documento. Edite a existente em vez de lançar outra.";

// A guia mudou entre a leitura e a gravação (outra pessoa pagou, estornou, cancelou, excluiu ou editou): o Prisma não
// encontra o registro com as condições do `where` e devolve P2025.
function guiaMudouNoMeioDaGravacao(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2025";
}

const MENSAGEM_GUIA_MUDOU = "Esta guia foi alterada por outra pessoa enquanto você a salvava. Atualize a tela, confira o estado atual e tente de novo.";

// Roda a gravação e transforma em 409 a violação do índice único e a guia que mudou no meio (devolve null; a resposta já foi
// enviada). As gravações que precisam de exclusão mútua (baixa, estorno, edição) põem as condições no `where` do update.
async function gravar<T>(
  response: { status: (c: number) => { json: (b: unknown) => void } },
  operacao: () => Promise<T>,
  mensagemSeMudou: string = MENSAGEM_GUIA_MUDOU,
): Promise<T | null> {
  try {
    return await operacao();
  } catch (error) {
    if (guiaMudouNoMeioDaGravacao(error)) {
      response.status(409).json({ message: mensagemSeMudou, code: "TAX_PAYMENT_CHANGED" });
      return null;
    }
    if (!ehNumeroRepetido(error)) throw error;
    response.status(409).json({ message: MENSAGEM_NUMERO_REPETIDO, code: "DUPLICATE_DOCUMENT" });
    return null;
  }
}

// Campos de texto livre: tipo e tamanho, para não gravar "[object Object]" nem texto sem limite.
const LIMITES_DE_TEXTO: Array<[string, number]> = [
  ["documentType", 80], ["legalName", 200], ["tradeName", 200], ["description", 500], ["comments", 2000], ["cnpj", 30],
];

function validarTextos(corpo: Record<string, unknown>): string | null {
  for (const [campo, limite] of LIMITES_DE_TEXTO) {
    const valor = corpo[campo];
    if (valor == null) continue;
    if (typeof valor !== "string" && !(campo === "cnpj" && typeof valor === "number")) return `Campo ${campo} inválido.`;
    if (String(valor).length > limite) return `Campo ${campo} com mais de ${limite} caracteres.`;
  }
  return null;
}

function mensagemDeGuiaRepetida(g: { documentType: string; competenceDate: Date | null }, numero: string) {
  const mes = g.competenceDate ? ` de ${g.competenceDate.toISOString().slice(5, 7)}/${g.competenceDate.toISOString().slice(0, 4)}` : "";
  return `Já existe a guia nº ${numero} (${g.documentType}${mes}). Edite a existente em vez de lançar outra.`;
}

function itensParaGravar(itens: ItemGuia[]) {
  return itens.map((i, position) => ({ position, code: i.code, description: i.description, principal: i.principal, fine: i.fine, interest: i.interest }));
}

taxPaymentRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const {
    companyId, cnpj, legalName, tradeName, documentType, description,
    competenceDate, dueDate, amount, paymentDate, paidAmount, comments, dreCategoryId, documentNumber, workersCount, employeeId, items, clientId,
  } = request.body as Record<string, unknown>;

  if (!documentType || typeof documentType !== "string" || !documentType.trim()) {
    return response.status(400).json({ message: "Tipo de documento obrigatório." });
  }
  const textoInvalido = validarTextos(request.body as Record<string, unknown>);
  if (textoInvalido) return response.status(400).json({ message: textoInvalido });

  // Reenvio do mesmo lançamento (timeout seguido de novo clique, nova tentativa do cliente HTTP): a tela manda um
  // identificador gerado uma vez por modal. Se a guia já existe com ele, devolve a que foi criada em vez de lançar outra.
  const idDoCliente = typeof clientId === "string" && ID_DO_CLIENTE.test(clientId) ? clientId.toLowerCase() : null;
  const incluirItens = { items: { orderBy: { position: "asc" as const } } };
  if (idDoCliente) {
    const jaCriada = await prisma.taxPayment.findFirst({ where: { id: idDoCliente }, include: incluirItens });
    if (jaCriada) {
      if (jaCriada.createdById !== user.id || jaCriada.deletedAt) {
        return response.status(409).json({ message: "Este identificador de lançamento já foi usado. Feche e abra o lançamento de novo.", code: "CLIENT_ID_IN_USE" });
      }
      // Só é reenvio se for o mesmo lançamento. Se a pessoa corrigiu algo depois de a resposta se perder, devolver a guia
      // antiga diria "lançada" e a correção se perderia: avisa e manda editar a guia já criada.
      if (!ehOMesmoLancamento(jaCriada, request.body as Record<string, unknown>)) {
        return response.status(409).json({
          message: "Esta guia já foi lançada antes (a resposta pode ter se perdido) e os dados que você enviou agora são outros. Feche, abra a guia na lista e corrija por lá.",
          code: "TAX_PAYMENT_ALREADY_CREATED",
          id: jaCriada.id,
        });
      }
      response.setHeader("Idempotent-Replayed", "true");
      return response.status(200).json(jaCriada);
    }
  }

  const vencimento = lerData(dueDate);
  if (!vencimento.ok || !vencimento.data) return response.status(400).json({ message: "Vencimento obrigatório e válido." });

  // Com discriminação, o valor da guia é a soma das linhas (o "amount" enviado, se vier, é ignorado).
  let itens: ItemGuia[] | null = null;
  let valor: number | null;
  if (items !== undefined) {
    const lidos = normalizarItens(items);
    if (!lidos.ok) return response.status(400).json({ message: lidos.message });
    itens = await aplicarCatalogoDeCodigos(documentType.trim(), lidos.itens);
    valor = lidos.total;
  } else {
    valor = parseValorGuia(amount);
  }
  if (valor == null) return response.status(400).json({ message: "Valor obrigatório e maior que zero." });

  const numero = lerNumeroDoDocumento(documentNumber);
  if (!numero.ok) return response.status(400).json({ message: "Número do documento inválido (até 60 caracteres)." });
  if (numero.valor) {
    const repetida = await guiaComEsteNumero(numero.valor);
    if (repetida) return response.status(409).json({ message: mensagemDeGuiaRepetida(repetida, numero.valor), code: "DUPLICATE_DOCUMENT" });
  }
  const trabalhadores = lerQuantidadeDeTrabalhadores(workersCount);
  if (!trabalhadores.ok) return response.status(400).json({ message: "Quantidade de trabalhadores inválida (número inteiro, de 0 a 100000)." });
  const funcionario = await lerFuncionarioDaGuia(employeeId, documentType);
  if (!funcionario.ok) return response.status(400).json({ message: funcionario.message });
  const descricao = typeof description === "string" && description.trim() ? description.trim() : itens ? descricaoDosItens(itens) : null;

  // Sem competência a guia não entra em DRE nenhum: é o que a tela promete ao lançar um imposto.
  const competencia = lerData(competenceDate);
  if (!competencia.ok || !competencia.data) {
    return response.status(400).json({ message: "Competência obrigatória: sem ela a guia fica fora do DRE." });
  }

  const pagamento = lerData(paymentDate);
  if (!pagamento.ok || (pagamento.data && !dataDePagamentoPlausivel(pagamento.data))) return response.status(400).json({ message: "Data de pagamento inválida." });
  const valorPago = pagamento.data ? (paidAmount == null || paidAmount === "" ? valor : parseValorGuia(paidAmount)) : null;
  if (pagamento.data && valorPago == null) return response.status(400).json({ message: "Valor pago deve ser maior que zero." });
  if (!pagamento.data && paidAmount != null && paidAmount !== "") {
    return response.status(400).json({ message: "Valor pago exige a data do pagamento. Para pagar depois, use a ação Pagar." });
  }

  if (await competenciaBloqueada(competencia.data, "Cadastro de imposto", response)) return;
  if (pagamento.data && await competenciaBloqueada(pagamento.data, "Cadastro de imposto (data do pagamento)", response)) return;

  // Sem categoria a guia cai em "Não categorizadas" no DRE. Campo ausente = regra pelo
  // tipo da guia; null ou "" = a pessoa escolheu deixar sem categoria.
  const categoriaId = dreCategoryId === undefined
    ? categoriaSugerida(await categoriasAtivas(), documentType, descricao).dreCategoryId
    : ((dreCategoryId as string) || null);

  // Dentro da função da gravação o TypeScript perde o estreitamento feito acima, então o vencimento é fixado antes.
  const dataDeVencimento: Date = vencimento.data;
  let reenvio = false;
  const created = await gravar(response, () => prisma.taxPayment.create({
    data: {
      id: idDoCliente ?? crypto.randomUUID(),
      companyId: (companyId as string) || null,
      cnpj: cnpj ? String(cnpj).replace(/\D/g, "") : null,
      legalName: (legalName as string) || null,
      tradeName: (tradeName as string) || null,
      documentType: String(documentType).trim(),
      description: descricao,
      documentNumber: numero.valor,
      workersCount: documentType.trim() === "FGTS" ? trabalhadores.valor : null,
      employeeId: funcionario.id,
      competenceDate: competencia.data,
      dueDate: dataDeVencimento,
      amount: valor,
      paymentDate: pagamento.data,
      paidAmount: valorPago,
      status: statusDaGuia(pagamento.data, dataDeVencimento),
      comments: (comments as string) || null,
      source: "MANUAL",
      dreCategoryId: categoriaId,
      createdById: user.id,
      ...(itens ? { items: { create: itensParaGravar(itens) } } : {}),
    },
    include: { items: { orderBy: { position: "asc" } } },
  }).catch(async (error: unknown) => {
    // Dois envios do mesmo lançamento ao mesmo tempo: o que perde a corrida bate na chave primária e recebe a guia criada.
    if (idDoCliente && ehIdRepetido(error)) {
      const existente = await prisma.taxPayment.findFirst({ where: { id: idDoCliente, createdById: user.id, deletedAt: null }, include: incluirItens });
      if (existente) { reenvio = true; return existente; }
    }
    throw error;
  }));
  if (!created) return;
  if (reenvio) {
    response.setHeader("Idempotent-Replayed", "true");
    return response.status(200).json(created);
  }
  if (itens) await guardarCodigosNovos(documentType.trim(), itens);

  await auditLog({
    userId: user.id,
    action: "CREATE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: created.id,
    newValue: created,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.status(201).json(created);
});

// ─── PUT /tax-payments/:id ────────────────────────────────────────────────────
// Pagar e estornar têm rota própria (/pay e /reverse), com 409 de "já pago", guarda de valor
// absurdo, trava do mês do pagamento e motivo no estorno. Aqui o pagamento é somente leitura:
// mexer nele pela edição contornava tudo isso. O status também não é aceito do formulário —
// sai das datas; a única escolha explícita é cancelar a guia (e reativá-la).
taxPaymentRouter.put("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null }, include: { items: { orderBy: { position: "asc" } } } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  const {
    companyId, cnpj, legalName, tradeName, documentType, description,
    competenceDate, dueDate, amount, paymentDate, paidAmount, comments, dreCategoryId, status, documentNumber, workersCount, employeeId, items,
  } = request.body as Record<string, unknown>;

  const textoInvalido = validarTextos(request.body as Record<string, unknown>);
  if (textoInvalido) return response.status(400).json({ message: textoInvalido });
  if (documentType !== undefined && (typeof documentType !== "string" || !documentType.trim())) {
    return response.status(400).json({ message: "Tipo de documento inválido." });
  }

  const pagoAnterior = existing.paidAmount == null ? null : Number(existing.paidAmount);
  const pagoInformado = paidAmount === null || paidAmount === "" ? null : Number(paidAmount);
  const pagamentoMudou =
    (paymentDate !== undefined && diaIso(paymentDate as string) !== diaIso(existing.paymentDate)) ||
    (paidAmount !== undefined && pagoInformado !== pagoAnterior);
  if (pagamentoMudou) {
    return response.status(400).json({
      message: "O pagamento não se altera na edição. Use Pagar para dar baixa ou Estornar para desfazer.",
    });
  }

  const vencimento = dueDate ? lerData(dueDate) : { ok: true as const, data: existing.dueDate };
  if (!vencimento.ok || !vencimento.data) return response.status(400).json({ message: "Vencimento inválido." });

  // Guia paga está fechada: mudar valores depois do pagamento desencontraria a baixa. Estorne em Contas a Pagar antes.
  const paga = Boolean(existing.paymentDate);
  const valorEnviado = amount != null && amount !== "" ? parseValorGuia(amount) : null;
  if (paga && (items !== undefined || (valorEnviado != null && valorEnviado !== Number(existing.amount)))) {
    return response.status(409).json({ message: "Esta guia já foi paga. Estorne o pagamento em Contas a Pagar antes de alterar os valores." });
  }

  let itens: ItemGuia[] | null = null;
  let valor: number | null;
  if (items !== undefined) {
    const lidos = normalizarItens(items);
    if (!lidos.ok) return response.status(400).json({ message: lidos.message });
    itens = await aplicarCatalogoDeCodigos(typeof documentType === "string" && documentType.trim() ? documentType.trim() : existing.documentType, lidos.itens);
    valor = lidos.total;
  } else {
    // Guia com composição: o valor é a soma das linhas, então mudar só o valor deixaria os dois desencontrados.
    if ((existing.items?.length ?? 0) > 0 && valorEnviado != null && valorEnviado !== Number(existing.amount)) {
      return response.status(400).json({ message: "Esta guia tem composição por linhas: altere as linhas, que o valor da guia é a soma delas." });
    }
    valor = amount != null && amount !== "" ? parseValorGuia(amount) : Number(existing.amount);
  }
  if (valor == null) return response.status(400).json({ message: "Valor deve ser maior que zero." });

  let trabalhadoresDaGuia = existing.workersCount;
  if (workersCount !== undefined) {
    const lido = lerQuantidadeDeTrabalhadores(workersCount);
    if (!lido.ok) return response.status(400).json({ message: "Quantidade de trabalhadores inválida (número inteiro, de 0 a 100000)." });
    trabalhadoresDaGuia = lido.valor;
  }

  const tipoFinal = typeof documentType === "string" ? documentType.trim() : existing.documentType;
  let funcionarioDaGuia = existing.employeeId;
  // Só revalida quando o vínculo mudou: quem foi readmitido depois da guia não pode travar a edição dela.
  if (employeeId !== undefined && (employeeId || null) !== existing.employeeId) {
    const lido = await lerFuncionarioDaGuia(employeeId, tipoFinal);
    if (!lido.ok) return response.status(400).json({ message: lido.message });
    funcionarioDaGuia = lido.id;
  } else if (tipoFinal !== "FGTS") {
    funcionarioDaGuia = null; // mudou de tipo: o vínculo com o funcionário não vale mais
  }

  let numeroDoDocumento = existing.documentNumber;
  if (documentNumber !== undefined) {
    const numero = lerNumeroDoDocumento(documentNumber);
    if (!numero.ok) return response.status(400).json({ message: "Número do documento inválido (até 60 caracteres)." });
    numeroDoDocumento = numero.valor;
    if (numero.valor && numero.valor !== existing.documentNumber) {
      const repetida = await guiaComEsteNumero(numero.valor, id);
      if (repetida) return response.status(409).json({ message: mensagemDeGuiaRepetida(repetida, numero.valor), code: "DUPLICATE_DOCUMENT" });
    }
  }

  const competencia = competenceDate !== undefined ? lerData(competenceDate) : { ok: true as const, data: existing.competenceDate };
  if (!competencia.ok) return response.status(400).json({ message: "Competência inválida." });

  // Só "CANCELED" é decisão do usuário; qualquer outro valor é ignorado e o status sai das datas.
  const cancelada = status !== undefined ? status === "CANCELED" : existing.status === "CANCELED";
  // Cancelar tira a guia de Contas a Pagar e do DRE (efeito de excluir) e reativar desfaz isso (como restaurar):
  // pela edição passaria com a permissão de editar, então pede a mesma de excluir.
  if (cancelada !== (existing.status === "CANCELED") && !(await userHasPermission(user as SessionUser, "tax-payments", "delete"))) {
    return response.status(403).json({ message: "Cancelar ou reativar uma guia exige a permissão de excluir." });
  }
  // Reativar uma guia cancelada: o número dela pode ter sido lançado de novo enquanto ela estava cancelada.
  if (existing.status === "CANCELED" && !cancelada && numeroDoDocumento) {
    const repetida = await guiaComEsteNumero(numeroDoDocumento, id);
    if (repetida) return response.status(409).json({ message: mensagemDeGuiaRepetida(repetida, numeroDoDocumento), code: "DUPLICATE_DOCUMENT" });
  }
  // Cancelar uma guia paga tiraria o desembolso do DRE e de Contas a Pagar com o pagamento ainda gravado.
  if (cancelada && existing.status !== "CANCELED" && existing.paymentDate) {
    return response.status(409).json({ message: "Esta guia está paga. Estorne o pagamento (em Contas a Pagar) antes de cancelar." });
  }
  if (!competencia.data && !cancelada) {
    return response.status(400).json({ message: "Competência obrigatória: sem ela a guia fica fora do DRE." });
  }

  // Vale para a competencia atual e para a pretendida: nem alterar imposto que ja esta
  // num mes fechado, nem mover um aberto para dentro de um fechado.
  if (await competenciaBloqueada(existing.competenceDate, "Edicao de imposto", response)) return;
  if (await competenciaBloqueada(competencia.data, "Edicao de imposto", response)) return;

  const descricaoFinal = itens && !(typeof description === "string" && description.trim())
    ? descricaoDosItens(itens)
    : description !== undefined ? ((description as string) || null) : existing.description;

  // Categoria ausente no corpo: segue a guia, a não ser que o tipo tenha mudado (a antiga não vale mais) ou que a guia
  // não tivesse categoria; nesses casos o servidor sugere pelo tipo e pelas linhas, como no lançamento.
  const categoriaFinal = dreCategoryId !== undefined
    ? ((dreCategoryId as string) || null)
    : tipoFinal !== existing.documentType || !existing.dreCategoryId
      ? categoriaSugerida(await categoriasAtivas(), tipoFinal, descricaoFinal).dreCategoryId
      : existing.dreCategoryId;

  // Dentro da função da gravação o TypeScript perde o estreitamento feito acima, então o vencimento é fixado antes.
  const dataDeVencimento: Date = vencimento.data;
  // Quem grava depois de outro pedido que mexeu na guia entre a leitura (acima) e este update bate no updatedAt: 409 em vez de
  // sobrescrever (ex.: uma edição que lê antes de uma baixa não pode devolver a guia paga para "em aberto").
  const updated = await gravar(response, () => prisma.taxPayment.update({
    where: { id, deletedAt: null, updatedAt: existing.updatedAt },
    data: {
      companyId: companyId !== undefined ? ((companyId as string) || null) : existing.companyId,
      cnpj: cnpj !== undefined ? (cnpj ? String(cnpj).replace(/\D/g, "") : null) : existing.cnpj,
      legalName: legalName !== undefined ? ((legalName as string) || null) : existing.legalName,
      tradeName: tradeName !== undefined ? ((tradeName as string) || null) : existing.tradeName,
      documentType: tipoFinal,
      description: descricaoFinal,
      documentNumber: numeroDoDocumento,
      workersCount: tipoFinal === "FGTS" ? trabalhadoresDaGuia : null,
      employeeId: funcionarioDaGuia,
      competenceDate: competencia.data,
      dueDate: dataDeVencimento,
      amount: valor,
      // "Sem comprovante" é um estado deliberado: editar a guia não pode apagá-lo (e reabrir a guia para uma segunda baixa).
      status: existing.status === "WITHOUT_RECEIPT" && !existing.paymentDate && !cancelada
        ? "WITHOUT_RECEIPT"
        : statusDaGuia(existing.paymentDate, dataDeVencimento, cancelada),
      comments: comments !== undefined ? ((comments as string) || null) : existing.comments,
      dreCategoryId: categoriaFinal,
      updatedById: user.id,
      // As linhas são regravadas por inteiro, na mesma operação que atualiza a guia.
      ...(itens ? { items: { deleteMany: {}, create: itensParaGravar(itens) } } : {}),
    },
    include: { items: { orderBy: { position: "asc" } } },
  }));
  if (!updated) return;
  if (itens) await guardarCodigosNovos(tipoFinal, itens);

  await auditLog({
    userId: user.id,
    action: "UPDATE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json(updated);
});

// ─── DELETE /tax-payments/:id (soft delete) ───────────────────────────────────
taxPaymentRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  // Excluir um imposto tira o valor do mes da competencia no DRE.
  if (await competenciaBloqueada(existing.competenceDate, "Exclusao de imposto", response)) return;
  // Guia paga também carrega o desembolso do mês do pagamento (a restauração já confere os dois).
  if (existing.paymentDate && await competenciaBloqueada(existing.paymentDate, "Exclusao de imposto (data do pagamento)", response)) return;

  await prisma.taxPayment.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.id },
  });

  await auditLog({
    userId: user.id,
    action: "DELETE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ ok: true });
});

// ─── PATCH /tax-payments/:id/restore ─────────────────────────────────────────
// Imposto era o unico dos tres modulos com exclusao logica que nao tinha volta:
// folha e funcionario ja tinham /restore, alcancado pela tela de Auditoria. Um
// imposto apagado por engano so voltava por SQL.
//
// Travas espelham as do estorno, e nao as da exclusao: restaurar devolve o valor
// ao mes da competencia E, se o imposto estava pago, devolve o desembolso ao mes
// do pagamento. Sao dois meses que podem estar fechados.
taxPaymentRouter.patch("/:id/restore", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!existing) return response.status(404).json({ message: "Lançamento excluído não encontrado (talvez já restaurado)." });

  if (await competenciaBloqueada(existing.competenceDate, "Restauração de imposto", response)) return;
  if (existing.paymentDate && await competenciaBloqueada(existing.paymentDate, "Restauração de imposto (data do pagamento)", response)) return;

  // A guia pode ter sido lançada de novo depois de excluída: restaurar as duas deixaria duas ativas com o mesmo número.
  if (existing.documentNumber && existing.status !== "CANCELED") {
    const repetida = await guiaComEsteNumero(existing.documentNumber, id);
    if (repetida) return response.status(409).json({ message: mensagemDeGuiaRepetida(repetida, existing.documentNumber), code: "DUPLICATE_DOCUMENT" });
  }

  // So recalcula o vencido de quem voltou em aberto. Pago continua pago, e
  // WITHOUT_RECEIPT/CANCELED sao estados deliberados que a restauracao nao decide.
  const recalcula = !existing.paymentDate && (existing.status === "PENDING" || existing.status === "OVERDUE");
  const status = recalcula ? statusDeGuiaEmAberto(existing.dueDate) : existing.status;

  const updated = await gravar(response, () => prisma.taxPayment.update({
    where: { id },
    data: { deletedAt: null, deletedById: null, status, updatedById: user.id },
  }));
  if (!updated) return;

  await auditLog({
    userId: user.id,
    action: "RESTORE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: updated.id,
    newValue: { restored: true, status },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, status: updated.status });
});

// ─── PATCH /tax-payments/:id/pay ─────────────────────────────────────────────
taxPaymentRouter.patch("/:id/pay", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const paymentDate = request.body.paymentDate ? new Date(String(request.body.paymentDate)) : null;
  const paidAmount = parseValorGuia(request.body.paidAmount) ?? 0;
  const comments = request.body.comments != null ? String(request.body.comments) : undefined;

  // Number.isFinite, nao so "<= 0": Number("1.234,56") e NaN, e NaN <= 0 e FALSO,
  // entao a guarda antiga deixava NaN passar direto para o banco.
  if (!paymentDate || isNaN(paymentDate.getTime()) || !Number.isFinite(paidAmount) || paidAmount <= 0) {
    return response.status(400).json({ message: "Data do pagamento e valor pago (> 0) são obrigatórios." });
  }
  // Ano digitado errado (1900, 2999) moveria o desembolso para um mês que não é o do pagamento.
  if (!dataDePagamentoPlausivel(paymentDate)) {
    return response.status(400).json({ message: "Data do pagamento fora do intervalo plausível (de 2015 até 60 dias à frente). Confira o ano." });
  }

  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  // Ja pago: sem esta guarda, repetir a chamada sobrescreve data e valor em
  // silencio. Aconteceu em producao — um titulo de R$ [valor] recebeu duas
  // baixas de R$ 14,31 com 34 segundos de diferenca (cara de toque duplo), e o
  // valor errado ficou de pe por um mes ate alguem pagar de novo para corrigir.
  // As rotas irmas (contas a pagar, folha, cartoes) ja exigem estorno antes de
  // repagar; aqui a correcao passa a deixar rastro em vez de apagar a anterior.
  // Guarda de valor absurdo: pega erro de digitacao sem criar atrito no caso normal.
  //
  // Ja existia em payroll.routes.ts e faltava aqui. Nao e a mesma coisa que exigir
  // justificativa quando o valor difere: diferenca pequena e rotina (juros, multa,
  // desconto) e tem tratamento proprio. Isto pega a ordem de grandeza errada — um
  // zero a mais, um valor colado no campo errado.
  //
  // As DUAS condicoes precisam valer para rejeitar: mais de 10x o titulo E mais de
  // R$ 10.000 acima dele. Assim um titulo de R$ 50 pago a R$ 600 (multa alta sobre
  // valor pequeno) passa, e um de R$ 500 pago a R$ 50.000 nao.
  const MAX_PAYMENT_MULTIPLIER = 10;
  const MIN_ABSURD_SURCHARGE = 10_000;
  const tituloOriginal = Number(existing.amount ?? 0);
  if (
    tituloOriginal > 0 &&
    paidAmount > tituloOriginal * MAX_PAYMENT_MULTIPLIER &&
    paidAmount - tituloOriginal > MIN_ABSURD_SURCHARGE
  ) {
    return response.status(400).json({
      message: `Valor pago (${paidAmount.toFixed(2)}) é mais de ${MAX_PAYMENT_MULTIPLIER}x o valor do imposto (${tituloOriginal.toFixed(2)}). Confira antes de baixar.`
    });
  }

  // Guia cancelada não é dívida: pagá-la a traria de volta ao DRE. Reative antes, na edição.
  if (existing.status === "CANCELED") {
    return response.status(409).json({ message: "Este imposto está cancelado. Reative a guia na edição antes de pagar." });
  }

  if (existing.status === "PAID" || existing.paymentDate) {
    return response.status(409).json({
      message: "Este imposto ja consta como pago. Estorne a baixa antes de lancar outra — assim a correcao fica registrada."
    });
  }

  // A trava de competencia ja existe neste arquivo e protege cadastro, edicao e
  // exclusao. Pagar ficara de fora, e pagar e justamente o que move o DRE: o
  // desembolso entra no mes da data do pagamento. Em producao ha baixa lancada
  // em competencia de 2022 com data de 2026.
  if (await competenciaBloqueada(existing.competenceDate, "Baixa de imposto", response)) return;
  if (await competenciaBloqueada(paymentDate, "Baixa de imposto (data do pagamento)", response)) return;

  const observacoes = observacoesDaBaixa(existing.comments, comments, tituloOriginal, paidAmount, paymentDate);

  // Duas baixas quase juntas (toque duplo, duas abas) passam pela checagem acima: só a primeira grava. A segunda não
  // encontra a guia "em aberto" e recebe 409, em vez de sobrescrever data e valor da primeira.
  const updated = await gravar(response, () => prisma.taxPayment.update({
    where: { id, deletedAt: null, paymentDate: null, status: { not: "CANCELED" } },
    data: {
      paymentDate,
      paidAmount,
      status: "PAID",
      // A nota da baixa e a diferença entre o pago e a guia entram depois das observações que a guia já tinha.
      ...(observacoes !== null ? { comments: observacoes } : {}),
      updatedById: user.id,
    },
  }), "Esta guia mudou enquanto era baixada (já foi paga, cancelada ou excluída por outra pessoa). Atualize a tela e confira antes de baixar de novo.");
  if (!updated) return;

  await auditLog({
    userId: user.id,
    action: "PAY_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, status: updated.status });
});

// ─── PATCH /tax-payments/:id/reverse ─────────────────────────────────────────
taxPaymentRouter.patch("/:id/reverse", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { id } = request.params;
  const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : null;
  if (!reason) return response.status(400).json({ message: "Motivo da reversão é obrigatório." });

  const existing = await prisma.taxPayment.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  if (!existing.paymentDate) {
    return response.status(400).json({ message: "Este lançamento ainda não possui pagamento para estornar." });
  }
  // Estornar reativaria em silêncio uma guia cancelada: o cancelamento é decidido na edição.
  if (existing.status === "CANCELED") {
    return response.status(409).json({ message: "Esta guia está cancelada. Reative-a na edição antes de estornar o pagamento." });
  }

  // Estornar tira o desembolso do mes em que ele entrou; se aquele mes estiver
  // fechado, o DRE dele muda depois de apurado. Mesma trava do cadastro.
  if (await competenciaBloqueada(existing.competenceDate, "Estorno de imposto", response)) return;
  if (await competenciaBloqueada(existing.paymentDate, "Estorno de imposto (data do pagamento)", response)) return;

  const reversedStatus = statusDeGuiaEmAberto(existing.dueDate);
  const observacoesDoEstornoDaGuia = observacoesDoEstorno(existing.comments, reason);

  const updated = await gravar(response, () => prisma.taxPayment.update({
    where: { id, deletedAt: null, paymentDate: { not: null }, status: { not: "CANCELED" } },
    data: {
      paymentDate: null,
      paidAmount: null,
      status: reversedStatus,
      ...(observacoesDoEstornoDaGuia !== null ? { comments: observacoesDoEstornoDaGuia } : {}),
      updatedById: user.id,
    },
  }), "Esta guia mudou enquanto era estornada (já foi estornada, cancelada ou excluída por outra pessoa). Atualize a tela e confira.");
  if (!updated) return;

  await auditLog({
    userId: user.id,
    action: "REVERSE_TAX_PAYMENT",
    entity: "TaxPayment",
    entityId: id,
    previousValue: existing,
    newValue: { ...updated, reverseReason: reason },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({ id: updated.id, status: updated.status });
});

// ─── GET /tax-payments/:id/history ───────────────────────────────────────────
taxPaymentRouter.get("/:id/history", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT a."id", a."userId", a."action", a."entity", a."entityId", a."previousValue", a."newValue", a."createdAt",
           u."name" AS "userName"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE a."entity" = 'TaxPayment' AND a."entityId" = ${request.params.id}
    ORDER BY a."createdAt" DESC
    LIMIT 50
  `;
  return response.json(rows);
});

// ─── POST /tax-payments/import-xlsx/preview ───────────────────────────────────
taxPaymentRouter.post("/import-xlsx/preview", upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ message: "Arquivo XLSX obrigatório." });

  // Planilhas de prévias antigas que nunca foram confirmadas (e confirmações que caíram no meio) não ficam para sempre.
  void limparUploadsAntigos().catch(() => undefined);

  // Buscar chaves de deduplicação já existentes no banco
  const existingKeySet = await buildExistingDedupKeys();

  try {
    const { filePath: _caminhoInterno, ...preview } = await previewTaxImport(request.file.path, existingKeySet);
    // Mostra na prévia em que categoria do DRE cada tipo vai entrar; null = sem regra.
    const categorias = await categoriasAtivas();
    const categoriasPorTipo: Record<string, Array<string | null>> = {};
    for (const row of preview.rows) {
      if (!row.valid || !row.documentType) continue;
      const nomes = categoriasPorTipo[row.documentType] ?? [];
      const { nome } = categoriaSugerida(categorias, row.documentType, row.description);
      if (!nomes.includes(nome)) categoriasPorTipo[row.documentType] = [...nomes, nome];
    }
    // O navegador só recebe o nome que o multer deu ao arquivo; o caminho no servidor nunca sai daqui.
    return response.json({ ...preview, importFileId: request.file.filename, categoriasPorTipo });
  } catch (error) {
    fs.unlink(request.file.path, () => undefined);
    return response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao processar arquivo." });
  }
});

// ─── POST /tax-payments/import-xlsx/confirm ───────────────────────────────────
taxPaymentRouter.post("/import-xlsx/confirm", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const { importFileId, importBatchId, skipDuplicates = true } = request.body as {
    importFileId?: string;
    importBatchId?: string;
    skipDuplicates?: boolean;
  };

  // Nunca aceitar caminho vindo do navegador: o servidor lê e apaga esse arquivo.
  const filePath = resolverUploadImportacao(importFileId, PASTA_UPLOADS);
  if (!filePath) return response.status(400).json({ message: "importFileId inválido. Faça o upload novamente." });
  if (!fs.existsSync(filePath)) return response.status(400).json({ message: "Arquivo não encontrado. Faça o upload novamente." });

  // Duas confirmações do mesmo arquivo (retry depois de timeout, aba duplicada) importariam tudo duas vezes: o arquivo é
  // "reservado" renomeando-o de forma atômica, e quem chega depois não o encontra.
  const emProcesso = `${filePath}.processando`;
  try {
    fs.renameSync(filePath, emProcesso);
  } catch {
    return response.status(409).json({ message: "Esta importação já está em andamento ou foi concluída. Confira a lista antes de importar de novo." });
  }
  // O arquivo só fica reservado enquanto a importação roda: se qualquer coisa falhar (banco fora, erro inesperado) ou a
  // conexão cair, ele volta ao nome original e a confirmação pode ser repetida. Concluída, some (inclusive do nome original).
  let emAndamento = true;
  const devolverArquivo = () => { try { fs.renameSync(emProcesso, filePath); } catch { /* já devolvido ou apagado */ } };
  const limparArquivo = () => {
    emAndamento = false;
    for (const caminho of [emProcesso, filePath]) { try { fs.unlinkSync(caminho); } catch { /* já apagado */ } }
  };
  response.once("close", () => { if (emAndamento) devolverArquivo(); });
  const existingKeySet = await buildExistingDedupKeys();
  let preview: Awaited<ReturnType<typeof previewTaxImport>>;
  try {
    preview = await previewTaxImport(emProcesso, existingKeySet);
  } catch (error) {
    limparArquivo();
    return response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao processar arquivo." });
  }

  const toImport = preview.rows.filter((r) => r.valid && (!skipDuplicates || !r.isDuplicate));

  // O DRE posiciona o imposto pela competenceDate. Importar planilha grava direto
  // num mes que pode estar fechado — e em LOTE, o que torna pior que a baixa
  // individual, que ja travava desde o F-33. Recusa o lote inteiro quando alguma
  // linha cai em periodo fechado, em vez de importar pela metade: meia importacao
  // e pior que nenhuma, porque parece completa.
  const linhaBloqueada = [];
  for (const row of toImport) {
    for (const [data, rotulo] of [[row.competenceDate, "competencia"], [row.dueDate, "vencimento"], [row.paymentDate, "pagamento"]] as Array<[Date | null | undefined, string]>) {
      if (!data || Number.isNaN(new Date(data).getTime())) continue;
      try {
        await assertPeriodWritableForDate(new Date(data), "Importacao de impostos");
      } catch (error) {
        if (!(error instanceof PeriodLockedError)) throw error;
        linhaBloqueada.push(`${rotulo} ${new Date(data).toISOString().slice(0, 10)}: ${error.message}`);
      }
    }
  }
  if (linhaBloqueada.length > 0) {
    devolverArquivo(); // o período pode ser reaberto e a confirmação repetida com o mesmo arquivo
    return response.status(400).json({
      message: `A importacao tem ${linhaBloqueada.length} lancamento(s) em periodo fechado e foi recusada por inteiro. Reabra o periodo ou remova essas linhas da planilha.`,
      bloqueios: linhaBloqueada.slice(0, 10)
    });
  }

  const batchId = importBatchId ?? crypto.randomUUID();
  const categorias = await categoriasAtivas();

  const created = await prisma.$transaction(async (tx) => {
    const records = [];
    for (const row of toImport) {
      const parsedPaymentDate = row.paymentDate;
      const parsedDueDate = row.dueDate!;
      const status = statusDaGuia(parsedPaymentDate, parsedDueDate);

      const record = await tx.taxPayment.create({
        data: {
          id: crypto.randomUUID(),
          cnpj: row.cnpj,
          legalName: row.legalName,
          tradeName: row.tradeName,
          documentType: row.documentType!,
          description: row.description,
          competenceDate: row.competenceDate,
          dueDate: parsedDueDate,
          amount: row.amount!,
          paymentDate: parsedPaymentDate,
          paidAmount: parsedPaymentDate ? row.amount : null,
          status: status as "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT",
          comments: row.comments,
          source: "IMPORT_XLSX",
          importBatchId: batchId,
          dreCategoryId: categoriaSugerida(categorias, row.documentType, row.description).dreCategoryId,
          createdById: user.id,
        },
      });
      records.push(record);
    }
    return records;
  }, { maxWait: 15_000, timeout: 120_000 }).catch((error) => {
    devolverArquivo();
    throw error;
  });

  limparArquivo();

  await auditLog({
    userId: user.id,
    action: "IMPORT_TAX_PAYMENTS",
    entity: "TaxPayment",
    newValue: { importBatchId: batchId, imported: created.length, total: preview.totalRows },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  return response.json({
    importBatchId: batchId,
    imported: created.length,
    skipped: preview.rows.length - toImport.length,
    total: preview.totalRows,
  });
});

// ─── COMPROVANTES DESATIVADOS (decisão de produto 2026-06-23) ─────────────────
// Comprovantes fiscais são mantidos fora do sistema — sem upload/download/delete.
const ATTACHMENT_GONE = {
  message: "Armazenamento de comprovantes desativado. Os comprovantes são mantidos fora do sistema.",
  code: "ATTACHMENTS_DISABLED",
} as const;
taxPaymentRouter.post("/:id/attachments", (_req, res) => { res.status(410).json(ATTACHMENT_GONE); });
taxPaymentRouter.delete("/:id/attachments/:attachmentId", (_req, res) => { res.status(410).json(ATTACHMENT_GONE); });
taxPaymentRouter.get("/:id/attachments/:attachmentId/download", (_req, res) => { res.status(410).json(ATTACHMENT_GONE); });

