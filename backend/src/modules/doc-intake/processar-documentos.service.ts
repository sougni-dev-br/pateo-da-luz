// Processamento dos arquivos enviados, com progresso.
//
// A leitura leva de 20 a 40 segundos por documento — mais quando é foto. Sem
// sinal de vida, a tela parece travada e a pessoa clica de novo ou desiste.
// Por isso o processamento avisa em que pé está, arquivo por arquivo, em vez de
// devolver tudo só no fim.

import { enriquecerDocumento, type DocumentoEnriquecido } from "./doc-enrich.service.js";
import { ArquivoGrandeDemaisError, extrairDocumento } from "./doc-extract.service.js";
import type { LlmProvider } from "./llm.provider.js";
import { TipoArquivoNaoSuportadoError } from "./tipo-arquivo.js";
import { LlmRequestError } from "./llm.provider.js";

export const MAX_BYTES_ARQUIVO = 15 * 1024 * 1024;

export type ArquivoRecebido = { nome?: unknown; base64?: unknown };

export type EventoProgresso =
  | { tipo: "inicio"; total: number }
  | { tipo: "arquivo"; indice: number; nome: string; situacao: "lendo" | "lido" | "falhou"; erro?: string }
  | { tipo: "etapa"; descricao: string };

export type ResultadoProcessamento = {
  documentos: DocumentoEnriquecido[];
  falhas: Array<{ arquivo: string; erro: string }>;
};

function nomeDe(recebido: ArquivoRecebido): string {
  return typeof recebido.nome === "string" && recebido.nome ? recebido.nome : "documento.pdf";
}

/** Erros esperados viram falha daquele arquivo; o resto sobe. */
function ehFalhaDoArquivo(erro: unknown): boolean {
  return erro instanceof ArquivoGrandeDemaisError
    || erro instanceof TipoArquivoNaoSuportadoError
    || erro instanceof LlmRequestError;
}

export async function processarDocumentos(params: {
  recebidos: ArquivoRecebido[];
  provider: LlmProvider;
  aoProgredir?: (evento: EventoProgresso) => void;
}): Promise<ResultadoProcessamento> {
  const { recebidos, provider } = params;
  const avisar = params.aoProgredir ?? (() => undefined);

  const documentos: DocumentoEnriquecido[] = [];
  const falhas: Array<{ arquivo: string; erro: string }> = [];

  avisar({ tipo: "inicio", total: recebidos.length });

  for (const [indice, recebido] of recebidos.entries()) {
    const nome = nomeDe(recebido);
    const falhar = (erro: string) => {
      falhas.push({ arquivo: nome, erro });
      avisar({ tipo: "arquivo", indice, nome, situacao: "falhou", erro });
    };

    if (typeof recebido.base64 !== "string" || !recebido.base64) {
      falhar("Arquivo vazio ou nao enviado.");
      continue;
    }

    const buffer = Buffer.from(recebido.base64.replace(/^data:[^,]*,/, ""), "base64");
    if (buffer.length === 0) {
      falhar("Arquivo vazio ou corrompido.");
      continue;
    }
    if (buffer.length > MAX_BYTES_ARQUIVO) {
      falhar(`Arquivo maior que ${MAX_BYTES_ARQUIVO / 1024 / 1024} MB.`);
      continue;
    }

    avisar({ tipo: "arquivo", indice, nome, situacao: "lendo" });
    try {
      const extraido = await extrairDocumento({ nomeArquivo: nome, buffer, provider });
      documentos.push(await enriquecerDocumento(extraido));
      avisar({ tipo: "arquivo", indice, nome, situacao: "lido" });
    } catch (erro) {
      if (ehFalhaDoArquivo(erro)) {
        falhar((erro as Error).message);
        continue;
      }
      // Erro inesperado derruba tudo: e bug, nao documento ruim.
      throw erro;
    }
  }

  return { documentos, falhas };
}
