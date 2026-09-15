// Extracao de um documento: PDF -> texto -> modelo -> conversao -> conferencia.
//
// Nada aqui escreve no banco. A saida e um rascunho com avisos; quem confirma
// e a pessoa na tela (fase 2). Aviso BLOQUEIO trava a confirmacao, ATENCAO so
// sinaliza.

import { hashArquivo, lerTextoPdf } from "./document-text.service.js";
import { identificarArquivo } from "./tipo-arquivo.js";
import { EXTRACAO_SCHEMA, montarPrompt, montarPromptVisao, type ExtracaoCrua, type TipoDocumento } from "./extraction.contract.js";

/** Teto do envio inline ao modelo. Acima disso o request e recusado pelo Google. */
const MAX_BYTES_VISAO = 10 * 1024 * 1024;
import type { LlmProvider } from "./llm.provider.js";
import { brToDate, brToNumber, chaveTitulo, isValidCnpj, onlyDigits, somaConfere } from "./document-validators.js";

export type NivelAviso = "BLOQUEIO" | "ATENCAO";

export type Aviso = {
  nivel: NivelAviso;
  codigo: string;
  mensagem: string;
};

export type Parte = {
  nome: string | null;
  cnpj: string | null;
  cnpjDigits: string | null;
  cnpjValido: boolean;
};

export type RubricaExtraida = {
  descricao: string;
  valor: number | null;
  valorRaw: string;
};

export type DocumentoExtraido = {
  nomeArquivo: string;
  hash: string;
  tipoDocumento: TipoDocumento;
  emissor: Parte;
  destinatario: Parte;
  numeroDocumento: string | null;
  dataEmissao: Date | null;
  dataEmissaoRaw: string | null;
  dataVencimento: Date | null;
  dataVencimentoRaw: string | null;
  valorTotal: number | null;
  valorTotalRaw: string | null;
  rubricas: RubricaExtraida[];
  linhaDigitavel: string | null;
  documentoReferenciado: string | null;
  /** Como o documento se identifica num parcelamento ("1/3"), quando informa. */
  parcela: string | null;
  observacoes: string | null;
  chaveTitulo: string | null;
  /** true quando o PDF nao tinha texto e foi lido como imagem — conferir com mais rigor. */
  lidoPorImagem: boolean;
  avisos: Aviso[];
  meta: { model: string; tokensUsed: number | null; paginas: number | null };
};

function montarParte(nome: string | null, cnpj: string | null): Parte {
  const digits = onlyDigits(cnpj) || null;
  return { nome, cnpj, cnpjDigits: digits, cnpjValido: isValidCnpj(cnpj) };
}

export async function extrairDocumento(params: {
  nomeArquivo: string;
  buffer: Buffer;
  provider: LlmProvider;
  /**
   * Diagnostico: manda pelo canal de imagem mesmo havendo texto. Serve para
   * exercitar o caminho de documento escaneado sem precisar de um escaneado em
   * maos, e para comparar as duas leituras do mesmo documento.
   */
  forcarVisao?: boolean;
}): Promise<DocumentoExtraido> {
  const arquivo = identificarArquivo(params.buffer, params.nomeArquivo);

  // Foto nao tem camada de texto para tentar: vai direto para leitura por imagem.
  // PDF tenta o texto primeiro, que e mais barato e mais exato que ler o desenho.
  const lido = arquivo.tipo === "IMAGEM"
    ? { texto: "", paginas: null, precisaVisao: true, hash: hashArquivo(params.buffer) }
    : await lerTextoPdf(params.buffer);
  const precisaVisao = lido.precisaVisao || params.forcarVisao === true;

  // Acima do limite o envio inline estoura o request do Google, entao falha
  // claro em vez de devolver erro cru.
  if (precisaVisao && params.buffer.length > MAX_BYTES_VISAO) {
    throw new ArquivoGrandeDemaisError(params.nomeArquivo, params.buffer.length);
  }

  const resposta = await params.provider.generateJson<ExtracaoCrua>(
    precisaVisao
      ? {
          prompt: montarPromptVisao(),
          schema: EXTRACAO_SCHEMA,
          arquivo: { mimeType: arquivo.mimeType, base64: params.buffer.toString("base64") },
        }
      : {
          prompt: montarPrompt(lido.texto),
          schema: EXTRACAO_SCHEMA,
        },
  );

  return montarDocumento({
    nomeArquivo: params.nomeArquivo,
    hash: lido.hash,
    paginas: lido.paginas,
    crua: resposta.data,
    model: resposta.model,
    tokensUsed: resposta.tokensUsed,
    lidoPorImagem: lido.precisaVisao,
  });
}

/** Separado da chamada de rede para poder testar a conferencia sem bater na API. */
export function montarDocumento(params: {
  nomeArquivo: string;
  hash: string;
  paginas: number | null;
  crua: ExtracaoCrua;
  model: string;
  tokensUsed: number | null;
  lidoPorImagem?: boolean;
}): DocumentoExtraido {
  const { crua } = params;
  const lidoPorImagem = params.lidoPorImagem ?? false;

  const rubricas: RubricaExtraida[] = (crua.rubricas ?? []).map((item) => ({
    descricao: item.descricao,
    valorRaw: item.valor,
    valor: brToNumber(item.valor),
  }));

  const valorTotal = brToNumber(crua.valorTotal);
  const dataEmissao = brToDate(crua.dataEmissao);
  const dataVencimento = brToDate(crua.dataVencimento);
  const emissor = montarParte(crua.emissorNome ?? null, crua.emissorCnpj ?? null);
  const destinatario = montarParte(crua.destinatarioNome ?? null, crua.destinatarioCnpj ?? null);

  const avisos: Aviso[] = [];

  if (valorTotal === null || valorTotal <= 0) {
    avisos.push({ nivel: "BLOQUEIO", codigo: "SEM_VALOR", mensagem: "Valor total nao foi identificado no documento." });
  }
  if (!dataVencimento) {
    avisos.push({ nivel: "BLOQUEIO", codigo: "SEM_VENCIMENTO", mensagem: "Data de vencimento nao foi identificada." });
  }
  if (!emissor.cnpjDigits) {
    avisos.push({ nivel: "BLOQUEIO", codigo: "SEM_CNPJ_EMISSOR", mensagem: "CNPJ do emissor nao foi identificado." });
  } else if (!emissor.cnpjValido) {
    avisos.push({ nivel: "BLOQUEIO", codigo: "CNPJ_EMISSOR_INVALIDO", mensagem: `CNPJ do emissor invalido (${emissor.cnpj}) — digito verificador nao confere.` });
  }
  if (destinatario.cnpjDigits && !destinatario.cnpjValido) {
    avisos.push({ nivel: "ATENCAO", codigo: "CNPJ_DESTINATARIO_INVALIDO", mensagem: `CNPJ do destinatario invalido (${destinatario.cnpj}).` });
  }
  if (!somaConfere(rubricas, valorTotal)) {
    const soma = rubricas.reduce((acc, item) => acc + (item.valor ?? 0), 0);
    avisos.push({
      nivel: "BLOQUEIO",
      codigo: "SOMA_NAO_CONFERE",
      mensagem: `Soma das rubricas (${soma.toFixed(2)}) difere do total (${valorTotal?.toFixed(2) ?? "?"}).`,
    });
  }
  if (dataEmissao && dataVencimento && dataVencimento < dataEmissao) {
    avisos.push({ nivel: "ATENCAO", codigo: "VENCIMENTO_ANTES_EMISSAO", mensagem: "Vencimento anterior a emissao — conferir se os campos nao vieram trocados." });
  }
  if (!crua.numeroDocumento) {
    avisos.push({ nivel: "ATENCAO", codigo: "SEM_NUMERO", mensagem: "Numero do documento nao identificado — a checagem de duplicidade fica mais fraca." });
  }
  if (lidoPorImagem) {
    // Documento sem camada de texto foi lido pela imagem. O risco de um digito
    // trocado e muito maior do que quando o valor vem do texto do PDF.
    avisos.push({
      nivel: "ATENCAO",
      codigo: "LIDO_POR_IMAGEM",
      mensagem: "Documento escaneado ou fotografado: os numeros foram lidos da imagem. Confira valor e vencimento com atencao redobrada.",
    });
  }

  return {
    nomeArquivo: params.nomeArquivo,
    hash: params.hash,
    tipoDocumento: crua.tipoDocumento ?? "OUTRO",
    emissor,
    destinatario,
    numeroDocumento: crua.numeroDocumento ?? null,
    dataEmissao,
    dataEmissaoRaw: crua.dataEmissao ?? null,
    dataVencimento,
    dataVencimentoRaw: crua.dataVencimento ?? null,
    valorTotal,
    valorTotalRaw: crua.valorTotal ?? null,
    rubricas,
    linhaDigitavel: crua.linhaDigitavel ?? null,
    documentoReferenciado: crua.documentoReferenciado ?? null,
    parcela: crua.parcela ?? null,
    observacoes: crua.observacoes ?? null,
    chaveTitulo: chaveTitulo({ cnpjEmissor: emissor.cnpjDigits, valorTotal, dataVencimento }),
    lidoPorImagem,
    avisos,
    meta: { model: params.model, tokensUsed: params.tokensUsed, paginas: params.paginas },
  };
}

export class ArquivoGrandeDemaisError extends Error {
  constructor(nomeArquivo: string, bytes: number) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    super(`"${nomeArquivo}" tem ${mb} MB e passa do limite de ${MAX_BYTES_VISAO / 1024 / 1024} MB para leitura por imagem. Tire a foto com menos resolução ou envie o PDF.`);
    this.name = "ArquivoGrandeDemaisError";
  }
}
