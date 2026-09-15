import { describe, expect, test, vi } from "vitest";
import { processarDocumentos, type EventoProgresso } from "../processar-documentos.service.js";
import { LlmRequestError, type LlmProvider } from "../llm.provider.js";

// Este teste cobre o FLUXO de progresso e o tratamento de falhas. A leitura do
// PDF e a detecção de tipo têm testes próprios (document-validators, tipo-arquivo),
// então aqui a extração é simulada — o provider continua real no caminho, para os
// casos de cota e de erro inesperado valerem.
vi.mock("../doc-extract.service.js", async (original) => {
  const real = await original<typeof import("../doc-extract.service.js")>();
  return {
    ...real,
    extrairDocumento: async (params: { nomeArquivo: string; buffer: Buffer; provider: { generateJson: (r: unknown) => Promise<unknown> } }) => {
      // Recusa o que não é PDF nem imagem, como o real faz.
      const { identificarArquivo } = await import("../tipo-arquivo.js");
      identificarArquivo(params.buffer, params.nomeArquivo);
      await params.provider.generateJson({ prompt: "", schema: {} });
      return {
        nomeArquivo: params.nomeArquivo, hash: "h", tipoDocumento: "NFSE",
        emissor: { nome: "X", cnpj: null, cnpjDigits: null, cnpjValido: false },
        destinatario: { nome: null, cnpj: null, cnpjDigits: null, cnpjValido: false },
        numeroDocumento: "1", dataEmissao: null, dataEmissaoRaw: null,
        dataVencimento: null, dataVencimentoRaw: null, valorTotal: 100, valorTotalRaw: "100,00",
        rubricas: [], linhaDigitavel: null, documentoReferenciado: null, parcela: null,
        observacoes: null, chaveTitulo: null, lidoPorImagem: false, avisos: [],
        meta: { model: "falso", tokensUsed: 10, paginas: 1 },
      };
    },
  };
});

// O enriquecimento consulta o banco; aqui só interessa o fluxo de progresso.
vi.mock("../doc-enrich.service.js", () => ({
  enriquecerDocumento: async (documento: unknown) => ({
    ...(documento as Record<string, unknown>),
    fornecedor: { cadastrado: false },
    empresa: null,
    duplicatas: [],
    podeConfirmar: true,
  }),
}));

const PDF_BASE64 = Buffer.from("%PDF-1.7\ntexto suficiente para o parser nao reclamar").toString("base64");

function providerFalso(comportamento: "ok" | "cota" = "ok"): LlmProvider {
  return {
    name: "falso",
    generateJson: async () => {
      if (comportamento === "cota") throw new LlmRequestError(429, "Cota diária esgotada.");
      return {
        data: {
          tipoDocumento: "NFSE", emissorNome: "X", emissorCnpj: "08.238.299/0001-29",
          destinatarioNome: "PATEO", destinatarioCnpj: "46.878.233/0001-92",
          numeroDocumento: "1", dataEmissao: "17/08/2026", dataVencimento: "15/09/2026",
          valorTotal: "100,00", rubricas: [{ descricao: "S", valor: "100,00" }],
          linhaDigitavel: null, documentoReferenciado: null, parcela: null, observacoes: null,
        },
        model: "falso",
        tokensUsed: 10,
      } as never;
    },
  };
}

function coletar() {
  const eventos: EventoProgresso[] = [];
  return { eventos, aoProgredir: (evento: EventoProgresso) => eventos.push(evento) };
}

describe("progresso da leitura", () => {
  test("avisa o total antes de começar", async () => {
    const { eventos, aoProgredir } = coletar();
    await processarDocumentos({
      recebidos: [{ nome: "a.pdf", base64: PDF_BASE64 }, { nome: "b.pdf", base64: PDF_BASE64 }],
      provider: providerFalso(),
      aoProgredir,
    });
    expect(eventos[0]).toEqual({ tipo: "inicio", total: 2 });
  });

  test("cada arquivo avisa quando começa e quando termina", async () => {
    const { eventos, aoProgredir } = coletar();
    await processarDocumentos({
      recebidos: [{ nome: "a.pdf", base64: PDF_BASE64 }],
      provider: providerFalso(),
      aoProgredir,
    });

    const doArquivo = eventos.filter((evento) => evento.tipo === "arquivo");
    expect(doArquivo.map((evento) => (evento as { situacao: string }).situacao)).toEqual(["lendo", "lido"]);
  });

  test("os eventos trazem o índice, para a tela saber qual linha atualizar", async () => {
    const { eventos, aoProgredir } = coletar();
    await processarDocumentos({
      recebidos: [{ nome: "a.pdf", base64: PDF_BASE64 }, { nome: "b.pdf", base64: PDF_BASE64 }],
      provider: providerFalso(),
      aoProgredir,
    });

    const indices = eventos.filter((e) => e.tipo === "arquivo").map((e) => (e as { indice: number }).indice);
    expect(indices).toEqual([0, 0, 1, 1]);
  });
});

describe("falhas não derrubam o lote", () => {
  test("arquivo inválido vira falha e a leitura continua", async () => {
    const { eventos, aoProgredir } = coletar();
    const resultado = await processarDocumentos({
      recebidos: [{ nome: "vazio.pdf", base64: "" }, { nome: "bom.pdf", base64: PDF_BASE64 }],
      provider: providerFalso(),
      aoProgredir,
    });

    expect(resultado.falhas).toHaveLength(1);
    expect(resultado.documentos).toHaveLength(1);
    expect(eventos.some((e) => e.tipo === "arquivo" && (e as { situacao: string }).situacao === "falhou")).toBe(true);
  });

  test("cota esgotada é reportada com a mensagem do serviço, não como erro genérico", async () => {
    const resultado = await processarDocumentos({
      recebidos: [{ nome: "a.pdf", base64: PDF_BASE64 }],
      provider: providerFalso("cota"),
    });

    expect(resultado.documentos).toHaveLength(0);
    expect(resultado.falhas[0].erro).toMatch(/Cota diária esgotada/);
  });

  test("arquivo que não é PDF nem imagem é recusado pelo conteúdo", async () => {
    const resultado = await processarDocumentos({
      recebidos: [{ nome: "planilha.zip", base64: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64") }],
      provider: providerFalso(),
    });

    expect(resultado.falhas[0].erro).toMatch(/não é um PDF nem uma foto/i);
  });

  test("erro inesperado sobe, em vez de virar 'documento ruim'", async () => {
    const quebrado: LlmProvider = {
      name: "quebrado",
      generateJson: async () => { throw new TypeError("bug de programação"); },
    };

    await expect(processarDocumentos({
      recebidos: [{ nome: "a.pdf", base64: PDF_BASE64 }],
      provider: quebrado,
    })).rejects.toThrow(/bug de programação/);
  });
});
