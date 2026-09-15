import { Router } from "express";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { agruparTitulos } from "./agrupamento-titulos.js";
import { listarLancamentosDaLeitura } from "./lancamentos.service.js";
import { createLlmProvider } from "./llm.provider.js";
import { processarDocumentos, type ArquivoRecebido, type EventoProgresso } from "./processar-documentos.service.js";
import { sugerirProdutos } from "./sugerir-produto.service.js";

export const docIntakeRouter = Router();

const MAX_ARQUIVOS = 5;

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

/**
 * Le documentos e devolve o RASCUNHO do lancamento. NAO grava nada.
 *
 * Responde em NDJSON (uma linha JSON por evento) e nao num JSON unico: a leitura
 * leva dezenas de segundos e a tela precisa dizer em que arquivo esta. Com um
 * JSON so, a pessoa fica olhando "carregando" sem saber se travou.
 *
 * A gravacao nao mora aqui de proposito: quando a pessoa confirma na tela, o
 * frontend chama POST /purchases, que ja concentra toda a regra de compra
 * (pequeno gasto, cartao, ciclo de fornecedor, parcelas, trava de periodo,
 * duplicidade). Um segundo caminho de escrita duplicaria essas regras.
 */
docIntakeRouter.post("/preview", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessao obrigatoria." });

  const body = request.body as { arquivos?: unknown };
  const recebidos = Array.isArray(body.arquivos) ? (body.arquivos as ArquivoRecebido[]) : [];

  if (recebidos.length === 0) {
    return response.status(400).json({ message: "Envie ao menos um arquivo em 'arquivos'." });
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

  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  // Sem isto, proxy e compressao seguram os pedacos e o progresso chega todo de
  // uma vez no fim — o que anula a razao de existir do streaming.
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  const emitir = (evento: EventoProgresso | Record<string, unknown>) => {
    response.write(`${JSON.stringify(evento)}\n`);
  };

  try {
    const { documentos, falhas } = await processarDocumentos({
      recebidos,
      provider,
      aoProgredir: emitir,
    });

    emitir({ tipo: "etapa", descricao: "Cruzando com o cadastro e montando os títulos" });

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

    emitir({ tipo: "fim", documentos, titulos, falhas });
  } catch (erro) {
    // Cabecalho ja foi enviado: nao da para trocar o status. O erro vai como
    // evento, e a tela sabe tratar.
    emitir({ tipo: "erro", mensagem: erro instanceof Error ? erro.message : "Falha inesperada na leitura." });
  } finally {
    response.end();
  }
});
