import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { LIMITE_DE_LANCAMENTOS, limitarGravacoes } from "../waste/waste-limite.js";
import { ANO_MAXIMO, ANO_MINIMO, descricaoDoTitulo, hojeEmSaoPaulo, resumir, situacaoDaColeta, validarEntrada, type EntradaDeColeta } from "./oil-collection-rules.js";

// Coleta de óleo de fritura. O acesso vem do módulo "oil-collections" (ver, lançar, editar,
// cancelar = excluir), aplicado pelo middleware de permissões.
//
// Cada coleta nasce com um título no Contas a Receber (sourceType OTHER). A baixa do PIX é feita lá, e
// a situação mostrada aqui vem do título. Esse título não alimenta o faturamento (RevenueEntry) nem o DRE.
export const oilCollectionsRouter = Router();
oilCollectionsRouter.use(limitarGravacoes(LIMITE_DE_LANCAMENTOS));

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const diaIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const COM_TITULO = { receivable: { select: { id: true, status: true, receivedDate: true, paidAmount: true } } } satisfies Prisma.OilCollectionInclude;
type Linha = Prisma.OilCollectionGetPayload<{ include: typeof COM_TITULO }>;

function serializar(c: Linha) {
  const status = situacaoDaColeta(c.cancelledAt !== null, c.receivable?.status ?? null);
  return {
    id: c.id,
    collectionDate: diaIso(c.collectionDate),
    collectorName: c.collectorName,
    certificateNumber: c.certificateNumber,
    volumeLiters: Number(c.volumeLiters),
    amount: Number(c.amount),
    status,
    receivableId: c.receivableId,
    receivedAt: diaIso(c.receivable?.receivedDate ?? null),
    paidAmount: Number(c.receivable?.paidAmount ?? 0),
    notes: c.notes,
    cancellationReason: c.cancellationReason,
    createdAt: c.createdAt
  };
}

async function usuario(request: Request, response: Response) {
  const user = await getSessionUser(request);
  if (!user) response.status(401).json({ message: "Sessao obrigatoria." });
  return user;
}

class ConflitoDeColeta extends Error {}

const mensagemDeDuplicada = (certificado: string | null) =>
  `Já existe uma coleta com o certificado ${certificado ?? ""} deste coletor. Confira se não é a mesma.`;
const MENSAGEM_DE_CONCORRENCIA = "Esta coleta mudou enquanto você mexia nela. Atualize a tela e confira.";
const MENSAGEM_JA_BAIXADA = "O PIX desta coleta já foi baixado no Contas a Receber. Data, volume e valor não mudam depois da baixa.";

function dadosDoBanco(d: EntradaDeColeta) {
  return {
    collectionDate: dia(d.collectionDate),
    collectorName: d.collectorName,
    certificateNumber: d.certificateNumber,
    volumeLiters: d.volumeLiters,
    amount: d.amount,
    notes: d.notes
  };
}

/** Campos do título que acompanham a coleta. A competência é o mês da coleta (o PIX é esperado no mesmo dia). */
function dadosDoTitulo(d: EntradaDeColeta) {
  return {
    customerName: d.collectorName,
    description: descricaoDoTitulo(d),
    sourceRef: d.certificateNumber ? `CDF ${d.certificateNumber}` : null,
    competenceYear: Number(d.collectionDate.slice(0, 4)),
    competenceMonth: Number(d.collectionDate.slice(5, 7)),
    expectedDate: dia(d.collectionDate),
    grossAmount: d.amount,
    netAmount: d.amount
  };
}

const respostaDoErro = (response: Response, falha: unknown, certificado: string | null) => {
  if (falha instanceof ConflitoDeColeta) return void response.status(409).json({ message: falha.message });
  if (isUniqueViolation(falha)) return void response.status(409).json({ message: mensagemDeDuplicada(certificado) });
  throw falha;
};

// Lista do ano (padrão: o corrente) com o resumo. Cancelada aparece na lista, mas fica fora dos totais.
oilCollectionsRouter.get("/", async (request, response) => {
  if (!(await usuario(request, response))) return;
  const pedido = request.query.year;
  if (pedido !== undefined && !/^\d{4}$/.test(String(pedido))) return void response.status(400).json({ message: "Ano inválido." });
  const ano = pedido === undefined ? Number(hojeEmSaoPaulo().slice(0, 4)) : Number(pedido);
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO) return void response.status(400).json({ message: "Ano inválido." });
  const status = request.query.status ? String(request.query.status) : null;
  if (status && !["PENDING", "PARTIAL", "RECEIVED", "CANCELLED"].includes(status)) return void response.status(400).json({ message: "Situação inválida." });

  const todas = await prisma.oilCollection.findMany({
    where: { collectionDate: { gte: dia(`${ano}-01-01`), lte: dia(`${ano}-12-31`) } },
    include: COM_TITULO,
    orderBy: [{ collectionDate: "desc" }, { createdAt: "desc" }]
  });
  const itens = todas.map(serializar);
  // PIX por chegar de qualquer ano: é o que ainda precisa ser conferido, mesmo que o ano na tela seja outro.
  const porChegar = await prisma.oilCollection.findMany({
    where: { cancelledAt: null, OR: [{ receivableId: null }, { receivable: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } } }] },
    select: { amount: true, receivable: { select: { paidAmount: true } } }
  });
  response.json({
    year: ano,
    minYear: ANO_MINIMO,
    summary: resumir(itens as Array<(typeof itens)[number] & { collectionDate: string }>),
    items: status ? itens.filter((i) => i.status === status) : itens,
    openPix: {
      count: porChegar.length,
      amount: Math.round(porChegar.reduce((soma, c) => soma + Math.max(0, Number(c.amount) - Number(c.receivable?.paidAmount ?? 0)), 0) * 100) / 100
    }
  });
});

oilCollectionsRouter.post("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const entrada = validarEntrada(request.body ?? {}, hojeEmSaoPaulo());
  if (!entrada.ok) return void response.status(400).json({ message: entrada.erro });
  const d = entrada.dados;
  try {
    // Coleta e título nascem juntos: sem o título o PIX não teria onde ser baixado.
    const criada = await prisma.oilCollection.create({
      data: {
        ...dadosDoBanco(d),
        registeredByUserId: user.id,
        receivable: { create: { ...dadosDoTitulo(d), sourceType: "OTHER", paymentMethod: "PIX", notes: "Gerado pela Coleta de óleo", status: "OPEN" } }
      },
      include: COM_TITULO
    });
    await auditLog({ userId: user.id, action: "CREATE_OIL_COLLECTION", entity: "OilCollection", entityId: criada.id, newValue: serializar(criada), ...auditMeta(request) });
    response.status(201).json(serializar(criada));
  } catch (falha) {
    respostaDoErro(response, falha, d.certificateNumber);
  }
});

// Depois da baixa, data, volume e valor não mudam: o que se conferiu é o valor do certificado, e trocá-lo
// por baixo deixaria o título baixado apontando para um número que ninguém viu.
const mudaOQueFoiConferido = (atual: Linha, d: EntradaDeColeta) =>
  diaIso(atual.collectionDate) !== d.collectionDate || Number(atual.volumeLiters) !== d.volumeLiters || Number(atual.amount) !== d.amount;

oilCollectionsRouter.patch("/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.oilCollection.findUnique({ where: { id: request.params.id }, include: COM_TITULO });
  if (!atual) return void response.status(404).json({ message: "Coleta não encontrada." });
  const situacao = serializar(atual).status;
  if (situacao === "CANCELLED") return void response.status(409).json({ message: "Esta coleta foi cancelada." });

  const entrada = validarEntrada({ ...serializar(atual), ...(request.body ?? {}) }, hojeEmSaoPaulo());
  if (!entrada.ok) return void response.status(400).json({ message: entrada.erro });
  const d = entrada.dados;
  const baixada = situacao === "RECEIVED" || situacao === "PARTIAL";
  if (baixada && mudaOQueFoiConferido(atual, d)) return void response.status(409).json({ message: MENSAGEM_JA_BAIXADA });

  try {
    const nova = await prisma.$transaction(async (tx) => {
      // Cancelamento que chegou no meio não é desfeito por esta gravação.
      const gravadas = await tx.oilCollection.updateMany({ where: { id: atual.id, cancelledAt: null }, data: dadosDoBanco(d) });
      if (gravadas.count === 0) throw new ConflitoDeColeta(MENSAGEM_DE_CONCORRENCIA);
      if (atual.receivableId) {
        const { customerName, description, sourceRef, ...financeiro } = dadosDoTitulo(d);
        await tx.receivable.update({ where: { id: atual.receivableId }, data: { customerName, description, sourceRef } });
        if (!baixada) {
          // Só mexe em valor e data se o título continua aberto: uma baixa que entrou agora vence esta edição.
          const abertos = await tx.receivable.updateMany({ where: { id: atual.receivableId, status: "OPEN" }, data: financeiro });
          if (abertos.count === 0) throw new ConflitoDeColeta(MENSAGEM_JA_BAIXADA);
        }
      }
      return tx.oilCollection.findUniqueOrThrow({ where: { id: atual.id }, include: COM_TITULO });
    });
    await auditLog({ userId: user.id, action: "UPDATE_OIL_COLLECTION", entity: "OilCollection", entityId: atual.id, previousValue: serializar(atual), newValue: serializar(nova), ...auditMeta(request) });
    response.json(serializar(nova));
  } catch (falha) {
    respostaDoErro(response, falha, d.certificateNumber);
  }
});

// Cancelar pede "excluir" (rota /cancel) e guarda o motivo: a coleta lançada errada não some do histórico.
// O título do Contas a Receber é cancelado junto, mas só enquanto não houve baixa.
oilCollectionsRouter.post("/:id/cancel", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const motivo = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
  if (motivo.length < 3) return void response.status(400).json({ message: "Informe o motivo do cancelamento." });
  if (motivo.length > 300) return void response.status(400).json({ message: "Motivo do cancelamento muito longo." });
  const atual = await prisma.oilCollection.findUnique({ where: { id: request.params.id }, include: COM_TITULO });
  if (!atual) return void response.status(404).json({ message: "Coleta não encontrada." });
  const situacao = serializar(atual).status;
  if (situacao === "CANCELLED") return void response.status(409).json({ message: "Esta coleta já foi cancelada." });
  if (situacao === "RECEIVED" || situacao === "PARTIAL") {
    return void response.status(409).json({ message: "O PIX desta coleta já foi baixado no Contas a Receber, então ela não pode ser cancelada por aqui." });
  }

  // Libera o número do certificado (o par coletor + certificado é único, e a coleta certa pode ser relançada),
  // mas o número original fica anotado na própria coleta para não depender só da auditoria.
  const certificado = atual.certificateNumber ? `${atual.certificateNumber}#cancelada-${atual.id.slice(-6)}` : null;
  const notas = [atual.notes, atual.certificateNumber ? `Certificado original: ${atual.certificateNumber}` : null].filter(Boolean).join(" · ") || null;
  try {
    const nova = await prisma.$transaction(async (tx) => {
      const gravadas = await tx.oilCollection.updateMany({
        where: { id: atual.id, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledByUserId: user.id, cancellationReason: motivo, certificateNumber: certificado, notes: notas }
      });
      if (gravadas.count === 0) throw new ConflitoDeColeta(MENSAGEM_DE_CONCORRENCIA);
      if (atual.receivableId) {
        // Se a baixa entrou entre a leitura e agora, o título não está mais aberto e a transação inteira volta atrás.
        const titulo = await tx.receivable.updateMany({
          where: { id: atual.receivableId, status: "OPEN" },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: user.id, cancellationReason: `Coleta de óleo cancelada: ${motivo}` }
        });
        if (titulo.count === 0) throw new ConflitoDeColeta(MENSAGEM_DE_CONCORRENCIA);
      }
      return tx.oilCollection.findUniqueOrThrow({ where: { id: atual.id }, include: COM_TITULO });
    });
    await auditLog({ userId: user.id, action: "CANCEL_OIL_COLLECTION", entity: "OilCollection", entityId: atual.id, previousValue: serializar(atual), newValue: { status: "CANCELLED", reason: motivo }, ...auditMeta(request) });
    response.json(serializar(nova));
  } catch (falha) {
    respostaDoErro(response, falha, atual.certificateNumber);
  }
});
