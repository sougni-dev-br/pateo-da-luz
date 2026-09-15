import { describe, expect, test } from "vitest";
import { montarDocumento } from "../doc-extract.service.js";
import type { ExtracaoCrua } from "../extraction.contract.js";

// Resposta crua equivalente a NFS-e real da Controlid (R$ 209,00, venc. 15/09/2026).
const NFSE_CONTROLID: ExtracaoCrua = {
  tipoDocumento: "NFSE",
  emissorNome: "CONTROLID INDUSTRIA, COMERCIO DE HARDWARE E SERVICOS DE TECNO",
  emissorCnpj: "08.238.299/0001-29",
  destinatarioNome: "PATEO FREI CANECA BAR E FORNERIA LTDA",
  destinatarioCnpj: "46.878.233/0001-92",
  numeroDocumento: "01454727",
  dataEmissao: "17/08/2026",
  dataVencimento: "15/09/2026",
  valorTotal: "209,00",
  rubricas: [{ descricao: "SUPORTE TECNICO DE INFORMATICA", valor: "209,00" }],
  linhaDigitavel: null,
  documentoReferenciado: null,
  observacoes: null,
};

function montar(crua: ExtracaoCrua) {
  return montarDocumento({
    nomeArquivo: "doc.pdf",
    hash: "hash-fake",
    paginas: 1,
    crua,
    model: "teste",
    tokensUsed: 100,
  });
}

describe("montarDocumento — caminho feliz", () => {
  test("converte valores e datas sem perder centavo nem trocar mes", () => {
    const doc = montar(NFSE_CONTROLID);
    expect(doc.valorTotal).toBe(209);
    expect(doc.dataVencimento?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(doc.dataEmissao?.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  test("nao levanta nenhum bloqueio", () => {
    const doc = montar(NFSE_CONTROLID);
    expect(doc.avisos.filter((aviso) => aviso.nivel === "BLOQUEIO")).toEqual([]);
  });

  test("preserva o valor cru ao lado do convertido, para conferencia", () => {
    const doc = montar(NFSE_CONTROLID);
    expect(doc.valorTotalRaw).toBe("209,00");
    expect(doc.rubricas[0].valorRaw).toBe("209,00");
  });
});

describe("montarDocumento — conferencias que bloqueiam", () => {
  test("bloqueia quando as rubricas nao somam o total", () => {
    const doc = montar({
      ...NFSE_CONTROLID,
      valorTotal: "19.150,50",
      rubricas: [
        { descricao: "Rateio condominio", valor: "14.250,00" },
        { descricao: "Energia eletrica", valor: "3.780,50" },
        // Falta a rubrica de R$ 1.120,00 — o modelo pulou uma linha.
      ],
    });
    const bloqueio = doc.avisos.find((aviso) => aviso.codigo === "SOMA_NAO_CONFERE");
    expect(bloqueio?.nivel).toBe("BLOQUEIO");
  });

  test("bloqueia CNPJ do emissor com digito verificador errado", () => {
    const doc = montar({ ...NFSE_CONTROLID, emissorCnpj: "08.238.299/0001-28" });
    expect(doc.avisos.some((aviso) => aviso.codigo === "CNPJ_EMISSOR_INVALIDO")).toBe(true);
  });

  test("bloqueia documento sem valor", () => {
    const doc = montar({ ...NFSE_CONTROLID, valorTotal: null, rubricas: [] });
    expect(doc.avisos.some((aviso) => aviso.codigo === "SEM_VALOR")).toBe(true);
  });

  test("bloqueia documento sem vencimento", () => {
    const doc = montar({ ...NFSE_CONTROLID, dataVencimento: null });
    expect(doc.avisos.some((aviso) => aviso.codigo === "SEM_VENCIMENTO")).toBe(true);
  });

  test("avisa quando vencimento vem antes da emissao", () => {
    const doc = montar({ ...NFSE_CONTROLID, dataEmissao: "15/09/2026", dataVencimento: "17/08/2026" });
    expect(doc.avisos.some((aviso) => aviso.codigo === "VENCIMENTO_ANTES_EMISSAO")).toBe(true);
  });
});

describe("montarDocumento — pareamento nota x boleto", () => {
  test("boleto da mesma nota gera a mesma chave de titulo", () => {
    const nota = montar(NFSE_CONTROLID);
    const boleto = montar({
      ...NFSE_CONTROLID,
      tipoDocumento: "BOLETO",
      emissorNome: "CONTROLID IND COM DE HARD E SERV DE TEC LTDA",
      numeroDocumento: "1454727/01",
      documentoReferenciado: "NFS-e:1454727/A",
      rubricas: [],
      linhaDigitavel: "34191.09065 14941.918956 10126.840007 3 15700000020900",
    });
    expect(nota.chaveTitulo).toBe(boleto.chaveTitulo);
    expect(nota.chaveTitulo).not.toBeNull();
  });
});
