import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { requireMenuPermission } from "../security/security-utils.js";
import { DIAS_DE_GUARDA_DO_RASCUNHO, conferirVersao, validarRascunho } from "./requisicao-rascunho.js";

// Requisições em andamento, salvas no sistema: qualquer aparelho e qualquer pessoa com acesso a Requisições
// abre, edita e conclui. Nada baixa do estoque aqui: isso só acontece ao concluir (POST /requisitions).
export const requisicaoRascunhoRouter = Router();

const DIA_MS = 24 * 60 * 60 * 1000;

async function nomesDosUsuarios(ids: Array<string | null>) {
  const unicos = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unicos.length === 0) return new Map<string, string>();
  const usuarios = await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true } });
  return new Map(usuarios.map((u) => [u.id, u.name]));
}

requisicaoRascunhoRouter.get("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  // Rascunho esquecido por mais de um mês sai da lista (ninguém reabre uma requisição daquela época).
  await prisma.inventoryRequisitionDraft.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - DIAS_DE_GUARDA_DO_RASCUNHO * DIA_MS) } } });

  const rascunhos = await prisma.inventoryRequisitionDraft.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  const nomes = await nomesDosUsuarios(rascunhos.flatMap((r) => [r.createdByUserId, r.updatedByUserId]));
  const escolhasDe = (payload: unknown) => (payload as { escolhas?: Record<string, { unit?: string; quantity?: string }> } | null)?.escolhas ?? {};
  const idsDosProdutos = Array.from(new Set(rascunhos.flatMap((r) => Object.keys(escolhasDe(r.payload)))));
  const produtos = idsDosProdutos.length > 0
    ? await prisma.product.findMany({ where: { id: { in: idsDosProdutos } }, select: { id: true, name: true } })
    : [];
  const nomeDoProduto = new Map(produtos.map((p) => [p.id, p.name]));
  response.json(rascunhos.map((r) => {
    const cabecalho = (r.payload as { cabecalho?: { date?: string; shift?: string } } | null)?.cabecalho ?? {};
    // O cartão da lista mostra o que a requisição tem, não só quantos itens: nome, quantidade e unidade de cada um.
    const itens = Object.entries(escolhasDe(r.payload))
      .map(([productId, e]) => ({ productId, name: nomeDoProduto.get(productId) ?? "Produto removido", quantity: e.quantity ?? "", unit: e.unit ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return {
      itens,
      id: r.id,
      itemCount: r.itemCount,
      summary: r.summary,
      version: r.version,
      date: cabecalho.date ?? null,
      shift: cabecalho.shift ?? null,
      createdByName: r.createdByUserId ? nomes.get(r.createdByUserId) ?? null : null,
      updatedByName: r.updatedByUserId ? nomes.get(r.updatedByUserId) ?? null : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  }));
});

requisicaoRascunhoRouter.get("/:id", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const rascunho = await prisma.inventoryRequisitionDraft.findUnique({ where: { id: request.params.id } });
  if (!rascunho) return void response.status(404).json({ message: "Rascunho não encontrado. Ele pode ter sido concluído ou descartado por outra pessoa." });
  const nomes = await nomesDosUsuarios([rascunho.updatedByUserId]);
  response.json({
    id: rascunho.id,
    conteudo: rascunho.payload,
    version: rascunho.version,
    updatedAt: rascunho.updatedAt,
    updatedByName: rascunho.updatedByUserId ? nomes.get(rascunho.updatedByUserId) ?? null : null
  });
});

requisicaoRascunhoRouter.post("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const validado = validarRascunho(request.body);
  if (!validado.ok) return void response.status(400).json({ message: validado.erro });
  const { conteudo, itemCount, summary } = validado.valor;

  const criado = await prisma.inventoryRequisitionDraft.create({
    data: { id: crypto.randomUUID(), payload: conteudo as unknown as Prisma.InputJsonValue, itemCount, summary, createdByUserId: user.id, updatedByUserId: user.id }
  });
  response.status(201).json({ id: criado.id, version: criado.version, updatedAt: criado.updatedAt });
});

requisicaoRascunhoRouter.put("/:id", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const validado = validarRascunho(request.body);
  if (!validado.ok) return void response.status(400).json({ message: validado.erro });
  const { conteudo, itemCount, summary } = validado.valor;

  const atual = await prisma.inventoryRequisitionDraft.findUnique({ where: { id: request.params.id } });
  if (!atual) return void response.status(404).json({ message: "Rascunho não encontrado. Ele pode ter sido concluído ou descartado por outra pessoa." });

  const versao = conferirVersao(atual.version, request.body?.version);
  if (!versao.ok) {
    const nomes = await nomesDosUsuarios([atual.updatedByUserId]);
    return void response.status(409).json({
      message: `Outra pessoa alterou esta requisição${atual.updatedByUserId ? ` (${nomes.get(atual.updatedByUserId) ?? "outro usuário"})` : ""}. Veja a versão mais recente antes de continuar.`,
      version: versao.atual,
      updatedAt: atual.updatedAt
    });
  }

  // updateMany com a versão no filtro: dois salvamentos ao mesmo tempo não passam os dois.
  const resultado = await prisma.inventoryRequisitionDraft.updateMany({
    where: { id: atual.id, version: atual.version },
    data: { payload: conteudo as unknown as Prisma.InputJsonValue, itemCount, summary, version: versao.proxima, updatedByUserId: user.id }
  });
  if (resultado.count === 0) return void response.status(409).json({ message: "Outra pessoa alterou esta requisição agora. Veja a versão mais recente antes de continuar.", version: atual.version + 1 });
  response.json({ id: atual.id, version: versao.proxima, updatedAt: new Date() });
});

requisicaoRascunhoRouter.delete("/:id", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  await prisma.inventoryRequisitionDraft.deleteMany({ where: { id: request.params.id } });
  response.json({ ok: true });
});
