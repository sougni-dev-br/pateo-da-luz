import { Router } from "express";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { agruparTitulos } from "./agrupamento-titulos.js";
import { enriquecerDocumento, type DocumentoEnriquecido } from "./doc-enrich.service.js";
import { ArquivoGrandeDemaisError, extrairDocumento } from "./doc-extract.service.js";
import { listarLancamentosDaLeitura } from "./lancamentos.service.js";
import { createLlmProvider, LlmRequestError } from "./llm.provider.js";
import { sugerirProdutos } from "./sugerir-produto.service.js";
import { TipoArquivoNaoSuportadoError } from "./tipo-arquivo.js";

export const docIntakeRouter = Router();

/**
 * O que ja foi lancado por este caminho. Serve para conferir o que entrou pela
 * leitura e, se um lote sair errado, saber exatamente o que cancelar.
 */
docIntakeRouter.get("/lancamentos", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessao obrigatoria." });

  const desdeTexto = String(request.query.desde ?? "").trim();
  const desde = desdeTexto ? new Date(desdeTexto) : null;

  const lancamentos = await listarLancamentosDaLeitura({
    desde: desde && !Number.isNaN(desde.getTime()) ? desde : null,
    incluirCanceladas: String(request.query.incluirCanceladas ?? "") === "true",
    limite: Number(request.query.limite ?? 100),
  });

  return response.json({
    lancamentos,
    total: lancamentos.length,
    somaTotal: lancamentos.reduce((soma, item) => soma + Number(item.totalAmount), 0),
  });
});

const MAX_ARQUIVOS = 5;
const MAX_BYTES = 15 * 1024 * 1024;

type ArquivoRecebido = { nome?: unknown; base64?: unknown };

/**
 * Le documentos e devolve o RASCUNHO do lancamento. NAO grava nada.
 *
 * A gravacao nao mora aqui de proposito: quando a pessoa confirma na tela, o
 * frontend chama POST /purchases, que ja concentra toda a regra de compra
 * (pequeno gasto, cartao, ciclo de fornecedor, parcelas, trava de periodo,
 * duplicidade). Um segundo caminho de escrita duplicaria essas regras e elas
 * divergiriam na primeira mudanca.
 */
docIntakeRouter.post("/preview", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessao obrigatoria." });

  const body = request.body as { arquivos?: unknown };
  const recebidos = Array.isArray(body.arquivos) ? (body.arquivos as ArquivoRecebido[]) : [];

  if (recebidos.length === 0) {
    return response.status(400).json({ message: "Envie ao menos um PDF em 'arquivos'." });
  }
  if (recebidos.length > MAX_ARQUIVOS) {
    return response.status(400).json({ message: `Envie no maximo ${MAX_ARQUIVOS} arquivos por vez.` });
  }

  const provider = createLlmProvider();
  if (!provider) {
    return response.status(503).json({
      message: "Leitura de documentos indisponivel: GEMINI_API_KEY nao configurada no ambiente.",
    });
  }

  const documentos: DocumentoEnriquecido[] = [];
  const falhas: Array<{ arquivo: string; erro: string }> = [];

  for (const recebido of recebidos) {
    const nomeArquivo = typeof recebido.nome === "string" && recebido.nome ? recebido.nome : "documento.pdf";

    if (typeof recebido.base64 !== "string" || !recebido.base64) {
      falhas.push({ arquivo: nomeArquivo, erro: "Arquivo vazio ou nao enviado." });
      continue;
    }

    const buffer = Buffer.from(recebido.base64.replace(/^data:[^,]*,/, ""), "base64");
    if (buffer.length === 0) {
      falhas.push({ arquivo: nomeArquivo, erro: "Arquivo vazio ou corrompido." });
      continue;
    }
    if (buffer.length > MAX_BYTES) {
      falhas.push({ arquivo: nomeArquivo, erro: `Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB.` });
      continue;
    }

    try {
      const extraido = await extrairDocumento({ nomeArquivo, buffer, provider });
      documentos.push(await enriquecerDocumento(extraido));
    } catch (error) {
      if (
        error instanceof ArquivoGrandeDemaisError
        || error instanceof TipoArquivoNaoSuportadoError
        || error instanceof LlmRequestError
      ) {
        falhas.push({ arquivo: nomeArquivo, erro: error.message });
        continue;
      }
      throw error;
    }
  }

  await auditLog({
    userId: user.id,
    action: "DOC_INTAKE_PREVIEW",
    entity: "DocumentIntake",
    entityId: null,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
    newValue: {
      arquivos: recebidos.map((arquivo) => (typeof arquivo.nome === "string" ? arquivo.nome : "?")),
      lidos: documentos.length,
      falhas: falhas.length,
      tokens: documentos.reduce((acc, doc) => acc + (doc.meta.tokensUsed ?? 0), 0),
    },
  }).catch(() => undefined);

  // Sugestao de produto por linha lida. Fica fora de agruparTitulos porque
  // depende do banco, e o agrupamento e logica pura — da para testar sem banco.
  const titulos = await Promise.all(
    agruparTitulos(documentos).map(async (titulo) => ({
      ...titulo,
      sugestoesItens: await sugerirProdutos({
        supplierId: titulo.fornecedor.cadastrado ? titulo.fornecedor.id : null,
        descricoes: titulo.rubricas.map((rubrica) => rubrica.descricao),
      }),
    })),
  );

  return response.json({ documentos, titulos, falhas });
});
