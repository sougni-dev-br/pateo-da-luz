import { describe, expect, test } from "vitest";
import { agruparTitulos, consolidarTitulo } from "../agrupamento-titulos.js";
import type { DocumentoEnriquecido } from "../doc-enrich.service.js";

const CNPJ = "08.238.299/0001-29";
const CNPJ_DIGITS = "08238299000129";
const OUTRO_CNPJ_DIGITS = "45758190000149";

function dia(ano: number, mes: number, diaDoMes: number): Date {
  return new Date(Date.UTC(ano, mes - 1, diaDoMes));
}

function doc(over: Partial<DocumentoEnriquecido> = {}): DocumentoEnriquecido {
  return {
    nomeArquivo: "arquivo.pdf",
    hash: Math.random().toString(36),
    tipoDocumento: "NFSE",
    emissor: { nome: "CONTROLID", cnpj: CNPJ, cnpjDigits: CNPJ_DIGITS, cnpjValido: true },
    destinatario: { nome: "PATEO", cnpj: "46.878.233/0001-92", cnpjDigits: "46878233000192", cnpjValido: true },
    numeroDocumento: "01454727",
    dataEmissao: dia(2026, 8, 17),
    dataEmissaoRaw: "17/08/2026",
    dataVencimento: dia(2026, 9, 15),
    dataVencimentoRaw: "15/09/2026",
    valorTotal: 209,
    valorTotalRaw: "209,00",
    rubricas: [{ descricao: "SUPORTE TECNICO", valor: 209, valorRaw: "209,00" }],
    linhaDigitavel: null,
    documentoReferenciado: null,
    parcela: null,
    observacoes: null,
    chaveTitulo: `${CNPJ_DIGITS}|209.00|2026-09-15`,
    lidoPorImagem: false,
    avisos: [],
    fornecedor: { cadastrado: true, id: "sup-1", nome: "CONTROLID LTDA" },
    empresa: { id: "emp-1", nome: "Pateo da Luz Frei" },
    duplicatas: [],
    podeConfirmar: true,
    meta: { model: "teste", tokensUsed: 10, paginas: 1 },
    ...over,
  };
}

/** Nota de R$ 3.000 que será paga em três boletos de R$ 1.000. */
const NOTA_PARCELADA = () => doc({
  nomeArquivo: "nota.pdf",
  tipoDocumento: "NFSE",
  numeroDocumento: "9001",
  valorTotal: 3000,
  dataVencimento: dia(2026, 10, 15),
  rubricas: [{ descricao: "SERVICO", valor: 3000, valorRaw: "3.000,00" }],
});

function boleto(over: Partial<DocumentoEnriquecido> = {}): DocumentoEnriquecido {
  return doc({
    tipoDocumento: "BOLETO",
    rubricas: [],
    linhaDigitavel: "34191.09065 14941.918956",
    ...over,
  });
}

describe("nota parcelada em vários boletos", () => {
  const boletosQueCitamANota = () => [
    boleto({ nomeArquivo: "b3.pdf", numeroDocumento: "9001/03", documentoReferenciado: "NF 9001", valorTotal: 1000, dataVencimento: dia(2026, 12, 15), parcela: "3/3" }),
    boleto({ nomeArquivo: "b1.pdf", numeroDocumento: "9001/01", documentoReferenciado: "NF 9001", valorTotal: 1000, dataVencimento: dia(2026, 10, 15), parcela: "1/3" }),
    boleto({ nomeArquivo: "b2.pdf", numeroDocumento: "9001/02", documentoReferenciado: "NF 9001", valorTotal: 1000, dataVencimento: dia(2026, 11, 15), parcela: "2/3" }),
  ];

  test("quatro arquivos viram UM título, não quatro despesas", () => {
    // Sem isto a conta quadruplicava: a nota mais os três boletos.
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...boletosQueCitamANota()]);
    expect(titulos).toHaveLength(1);
    expect(titulos[0].documentos).toHaveLength(4);
  });

  test("o total é o da nota, não a soma de tudo que foi enviado", () => {
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...boletosQueCitamANota()]);
    expect(titulos[0].valorTotal).toBe(3000);
  });

  test("cada boleto vira uma parcela, ordenada por vencimento", () => {
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...boletosQueCitamANota()]);
    const parcelas = titulos[0].parcelas;

    expect(parcelas).toHaveLength(3);
    expect(parcelas.map((parcela) => parcela.numero)).toEqual([1, 2, 3]);
    expect(parcelas.map((parcela) => parcela.dataVencimento?.toISOString().slice(0, 10)))
      .toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
    expect(parcelas.every((parcela) => parcela.valor === 1000)).toBe(true);
  });

  test("cada parcela diz de qual arquivo veio, para dar para conferir", () => {
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...boletosQueCitamANota()]);
    expect(titulos[0].parcelas.map((parcela) => parcela.origem)).toEqual(["b1.pdf", "b2.pdf", "b3.pdf"]);
  });

  test("agrupa também quando o boleto não cita a nota, mas a soma bate exatamente", () => {
    const semCitacao = boletosQueCitamANota().map((b) => ({ ...b, documentoReferenciado: null, numeroDocumento: "777" }));
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...semCitacao]);
    expect(titulos).toHaveLength(1);
    expect(titulos[0].parcelas).toHaveLength(3);
  });

  test("avisa que o título é parcelado, para a conferência não passar batido", () => {
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...boletosQueCitamANota()]);
    expect(titulos[0].avisos.some((aviso) => aviso.codigo === "TITULO_PARCELADO")).toBe(true);
  });
});

describe("parcelamento — quando algo não fecha", () => {
  test("bloqueia quando falta um boleto e as parcelas não somam o total", () => {
    // Dois boletos de 1.000 citando uma nota de 3.000: falta um.
    const doisBoletos = [
      boleto({ nomeArquivo: "b1.pdf", numeroDocumento: "9001/01", documentoReferenciado: "NF 9001", valorTotal: 1000, dataVencimento: dia(2026, 10, 15) }),
      boleto({ nomeArquivo: "b2.pdf", numeroDocumento: "9001/02", documentoReferenciado: "NF 9001", valorTotal: 1000, dataVencimento: dia(2026, 11, 15) }),
    ];
    const titulos = agruparTitulos([NOTA_PARCELADA(), ...doisBoletos]);

    const bloqueio = titulos[0].avisos.find((aviso) => aviso.codigo === "PARCELAS_NAO_SOMAM");
    expect(bloqueio?.nivel).toBe("BLOQUEIO");
    expect(titulos[0].podeConfirmar).toBe(false);
  });

  test("boleto de outro fornecedor não entra no título", () => {
    const intruso = boleto({
      nomeArquivo: "outro.pdf",
      emissor: { nome: "CASTELAO", cnpj: "45.758.190/0001-49", cnpjDigits: OUTRO_CNPJ_DIGITS, cnpjValido: true },
      valorTotal: 1000,
      dataVencimento: dia(2026, 10, 15),
      documentoReferenciado: "NF 9001",
    });
    const titulos = agruparTitulos([NOTA_PARCELADA(), intruso]);

    expect(titulos).toHaveLength(2);
    expect(titulos[0].documentos).not.toContain("outro.pdf");
  });
});

describe("boletos sem a nota", () => {
  test("boletos com a mesma raiz de número viram um título parcelado", () => {
    // "9001/01" e "9001/02" são do mesmo título, mesmo sem a nota em mãos.
    const titulos = agruparTitulos([
      boleto({ nomeArquivo: "b1.pdf", numeroDocumento: "9001/01", valorTotal: 1000, dataVencimento: dia(2026, 10, 15) }),
      boleto({ nomeArquivo: "b2.pdf", numeroDocumento: "9001/02", valorTotal: 1000, dataVencimento: dia(2026, 11, 15) }),
    ]);

    expect(titulos).toHaveLength(1);
    expect(titulos[0].parcelas).toHaveLength(2);
    // Sem nota, o total do título é a soma dos boletos.
    expect(titulos[0].valorTotal).toBe(2000);
  });

  test("boletos de títulos diferentes não se misturam", () => {
    const titulos = agruparTitulos([
      boleto({ nomeArquivo: "a.pdf", numeroDocumento: "9001/01", valorTotal: 1000, dataVencimento: dia(2026, 10, 15) }),
      boleto({ nomeArquivo: "b.pdf", numeroDocumento: "5500/01", valorTotal: 700, dataVencimento: dia(2026, 10, 20) }),
    ]);
    expect(titulos).toHaveLength(2);
  });
});

describe("caso simples — nota e boleto único", () => {
  test("continua virando um título de uma parcela", () => {
    const nota = doc({ nomeArquivo: "nota.pdf" });
    const boletoUnico = boleto({ nomeArquivo: "boleto.pdf", numeroDocumento: "1454727/01", documentoReferenciado: "NFS-e:1454727" });
    const titulos = agruparTitulos([boletoUnico, nota]);

    expect(titulos).toHaveLength(1);
    expect(titulos[0].parcelas).toHaveLength(1);
    expect(titulos[0].valorTotal).toBe(209);
    expect(titulos[0].numeroDocumento).toBe("01454727");
  });

  test("nota sozinha vira título de uma parcela, com o vencimento dela", () => {
    const titulos = agruparTitulos([doc({ nomeArquivo: "nota.pdf" })]);
    expect(titulos[0].parcelas).toHaveLength(1);
    expect(titulos[0].parcelas[0].dataVencimento?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  test("a ordem em que os arquivos chegam não muda o resultado", () => {
    const nota = doc({ nomeArquivo: "nota.pdf" });
    const b = boleto({ nomeArquivo: "boleto.pdf", documentoReferenciado: "NFS-e:1454727" });
    const a1 = consolidarTitulo([nota, b]);
    const a2 = consolidarTitulo([b, nota]);
    expect(a1.numeroDocumento).toBe(a2.numeroDocumento);
    expect(a1.valorTotal).toBe(a2.valorTotal);
  });
});

describe("avisos", () => {
  test("aviso repetido nos documentos aparece uma vez só", () => {
    const aviso = { nivel: "ATENCAO" as const, codigo: "FORNECEDOR_NAO_CADASTRADO", mensagem: "não cadastrado" };
    const titulo = consolidarTitulo([doc({ avisos: [aviso] }), boleto({ avisos: [aviso] })]);
    expect(titulo.avisos.filter((a) => a.codigo === "FORNECEDOR_NAO_CADASTRADO")).toHaveLength(1);
  });

  test("marca leitura por imagem se qualquer documento do título foi fotografado", () => {
    const titulo = consolidarTitulo([doc(), boleto({ lidoPorImagem: true })]);
    expect(titulo.lidoPorImagem).toBe(true);
  });
});
