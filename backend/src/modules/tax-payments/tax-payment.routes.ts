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
import { aplicarCatalogoDeCodigos } from "./tax-code-catalog.js";
import { diaIso, hojeBrasilia, lerData, parseValorGuia, resolverUploadImportacao, statusDaGuia } from "./tax-payment-rules.js";

export const taxPaymentRouter = Router();

// ─── upload multer ────────────────────────────────────────────────────────────
const upload = multer({
  dest: "uploads/",
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
const PASTA_UPLOADS = "uploads/";

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
taxPaymentRouter.get("/", async (request, response) => {
  const {
    companyId,
    cnpj,
    documentType,
    status,
    competenceStart,
    competenceEnd,
    dueStart,
    dueEnd,
    paymentStart,
    paymentEnd,
    search,
    dreCategoryId,
    page = "1",
    pageSize = "50",
  } = request.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
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
  if (documentType) conditions.push(`tp."documentType" ILIKE ${addParam(`%${documentType}%`)}`);
  if (dreCategoryId) conditions.push(`tp."dreCategoryId" = ${addParam(dreCategoryId)}`);

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

  if (competenceStart) conditions.push(`tp."competenceDate" >= ${addParam(new Date(competenceStart))}`);
  if (competenceEnd) conditions.push(`tp."competenceDate" <= ${addParam(new Date(competenceEnd + "T23:59:59.999Z"))}`);
  if (dueStart) conditions.push(`tp."dueDate" >= ${addParam(new Date(dueStart))}`);
  if (dueEnd) conditions.push(`tp."dueDate" <= ${addParam(new Date(dueEnd + "T23:59:59.999Z"))}`);
  if (paymentStart) conditions.push(`tp."paymentDate" >= ${addParam(new Date(paymentStart))}`);
  if (paymentEnd) conditions.push(`tp."paymentDate" <= ${addParam(new Date(paymentEnd + "T23:59:59.999Z"))}`);

  if (search) {
    const like = addParam(`%${search}%`);
    conditions.push(`(tp."legalName" ILIKE ${like} OR tp."tradeName" ILIKE ${like} OR tp."description" ILIKE ${like} OR tp."cnpj" ILIKE ${like} OR tp."documentNumber" ILIKE ${like})`);
  }

  const where = conditions.join(" AND ");

  const [rows, countResult, summary] = await Promise.all([
    prisma.$queryRawUnsafe<TaxPaymentRow[]>(`
      SELECT
        tp.*,
        dc.name AS "dreCategoryName",
        (SELECT COUNT(*)::int FROM "TaxPaymentItem" ti WHERE ti."taxPaymentId" = tp.id) AS "itemsCount"
      FROM "TaxPayment" tp
      LEFT JOIN "DRECategory" dc ON dc.id = tp."dreCategoryId"
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

// Painel da tela: a pagar por faixa de vencimento, guias por situação e meses já lançados.
// Antes de "/:id" pelo mesmo motivo das categorias.
taxPaymentRouter.get("/panorama", async (_request, response) => {
  response.json(await montarPanorama());
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

// Roda a gravação e transforma a violação do índice único em 409 (devolve null; a resposta já foi enviada).
async function gravar<T>(response: { status: (c: number) => { json: (b: unknown) => void } }, operacao: () => Promise<T>): Promise<T | null> {
  try {
    return await operacao();
  } catch (error) {
    if (!ehNumeroRepetido(error)) throw error;
    response.status(409).json({ message: MENSAGEM_NUMERO_REPETIDO, code: "DUPLICATE_DOCUMENT" });
    return null;
  }
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
    competenceDate, dueDate, amount, paymentDate, paidAmount, comments, dreCategoryId, documentNumber, workersCount, items,
  } = request.body as Record<string, unknown>;

  if (!documentType || typeof documentType !== "string" || !documentType.trim()) {
    return response.status(400).json({ message: "Tipo de documento obrigatório." });
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
  const descricao = typeof description === "string" && description.trim() ? description.trim() : itens ? descricaoDosItens(itens) : null;

  // Sem competência a guia não entra em DRE nenhum: é o que a tela promete ao lançar um imposto.
  const competencia = lerData(competenceDate);
  if (!competencia.ok || !competencia.data) {
    return response.status(400).json({ message: "Competência obrigatória: sem ela a guia fica fora do DRE." });
  }

  const pagamento = lerData(paymentDate);
  if (!pagamento.ok) return response.status(400).json({ message: "Data de pagamento inválida." });
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
  const created = await gravar(response, () => prisma.taxPayment.create({
    data: {
      id: crypto.randomUUID(),
      companyId: (companyId as string) || null,
      cnpj: cnpj ? String(cnpj).replace(/\D/g, "") : null,
      legalName: (legalName as string) || null,
      tradeName: (tradeName as string) || null,
      documentType: String(documentType).trim(),
      description: descricao,
      documentNumber: numero.valor,
      workersCount: trabalhadores.valor,
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
  }));
  if (!created) return;

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
    competenceDate, dueDate, amount, paymentDate, paidAmount, comments, dreCategoryId, status, documentNumber, workersCount, items,
  } = request.body as Record<string, unknown>;

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

  // Dentro da função da gravação o TypeScript perde o estreitamento feito acima, então o vencimento é fixado antes.
  const dataDeVencimento: Date = vencimento.data;
  const updated = await gravar(response, () => prisma.taxPayment.update({
    where: { id },
    data: {
      companyId: companyId !== undefined ? ((companyId as string) || null) : existing.companyId,
      cnpj: cnpj !== undefined ? (cnpj ? String(cnpj).replace(/\D/g, "") : null) : existing.cnpj,
      legalName: legalName !== undefined ? ((legalName as string) || null) : existing.legalName,
      tradeName: tradeName !== undefined ? ((tradeName as string) || null) : existing.tradeName,
      documentType: documentType ? String(documentType).trim() : existing.documentType,
      description: itens && !(typeof description === "string" && description.trim())
        ? descricaoDosItens(itens)
        : description !== undefined ? ((description as string) || null) : existing.description,
      documentNumber: numeroDoDocumento,
      workersCount: trabalhadoresDaGuia,
      competenceDate: competencia.data,
      dueDate: dataDeVencimento,
      amount: valor,
      status: statusDaGuia(existing.paymentDate, dataDeVencimento, cancelada),
      comments: comments !== undefined ? ((comments as string) || null) : existing.comments,
      dreCategoryId: dreCategoryId !== undefined ? ((dreCategoryId as string) || null) : existing.dreCategoryId,
      updatedById: user.id,
      // As linhas são regravadas por inteiro, na mesma operação que atualiza a guia.
      ...(itens ? { items: { deleteMany: {}, create: itensParaGravar(itens) } } : {}),
    },
    include: { items: { orderBy: { position: "asc" } } },
  }));
  if (!updated) return;

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
  const now = new Date();
  const recalcula = !existing.paymentDate && (existing.status === "PENDING" || existing.status === "OVERDUE");
  const status = recalcula
    ? (existing.dueDate && existing.dueDate < now ? "OVERDUE" : "PENDING")
    : existing.status;

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: { deletedAt: null, deletedById: null, status, updatedById: user.id },
  });

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
  const paidAmount = Number(request.body.paidAmount ?? 0);
  const comments = request.body.comments != null ? String(request.body.comments) : undefined;

  // Number.isFinite, nao so "<= 0": Number("1.234,56") e NaN, e NaN <= 0 e FALSO,
  // entao a guarda antiga deixava NaN passar direto para o banco.
  if (!paymentDate || isNaN(paymentDate.getTime()) || !Number.isFinite(paidAmount) || paidAmount <= 0) {
    return response.status(400).json({ message: "Data do pagamento e valor pago (> 0) são obrigatórios." });
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

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: {
      paymentDate,
      paidAmount,
      status: "PAID",
      ...(comments !== undefined ? { comments } : {}),
      updatedById: user.id,
    },
  });

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

  const now = new Date();
  const reversedStatus = existing.dueDate && existing.dueDate < now ? "OVERDUE" : "PENDING";

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: {
      paymentDate: null,
      paidAmount: null,
      status: reversedStatus,
      updatedById: user.id,
    },
  });

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
    SELECT a.*, u."name" AS "userName", u."email" AS "userEmail"
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

  const limparArquivo = () => fs.unlink(filePath, () => undefined);
  const existingKeySet = await buildExistingDedupKeys();
  let preview: Awaited<ReturnType<typeof previewTaxImport>>;
  try {
    preview = await previewTaxImport(filePath, existingKeySet);
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
  });

  fs.unlink(filePath, () => undefined);

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

