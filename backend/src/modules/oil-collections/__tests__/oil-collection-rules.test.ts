import { describe, expect, it } from "vitest";
import { dataIsoValida, descricaoDoTitulo, hojeEmSaoPaulo, lerNumero, normalizarColetor, passaDeAmanha, resumir, situacaoDaColeta, validarEntrada } from "../oil-collection-rules.js";

const HOJE = "2026-10-23";
const base = { collectionDate: "2026-10-23", volumeLiters: "70", amount: "140,00", certificateNumber: " 107257 " };

describe("validarEntrada", () => {
  it("aceita o certificado do exemplo: 70 L, R$ 140,00, Retióleo por padrão", () => {
    const r = validarEntrada(base, HOJE);
    expect(r).toEqual({
      ok: true,
      dados: { collectionDate: "2026-10-23", collectorName: "Retióleo", certificateNumber: "107257", volumeLiters: 70, amount: 140, notes: null }
    });
  });

  it("aceita vírgula decimal no volume", () => {
    const r = validarEntrada({ ...base, volumeLiters: "70,5" }, HOJE);
    expect(r.ok && r.dados.volumeLiters).toBe(70.5);
  });

  it("aceita valor zero (coleta sem pagamento) e certificado em branco", () => {
    const r = validarEntrada({ ...base, amount: 0, certificateNumber: "" }, HOJE);
    expect(r.ok && r.dados.certificateNumber).toBeNull();
  });

  it("recusa data inválida, futura e volume ausente ou zero", () => {
    expect(validarEntrada({ ...base, collectionDate: "2026-02-31" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, collectionDate: "2026-10-30" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, volumeLiters: "" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, volumeLiters: 0 }, HOJE).ok).toBe(false);
  });

  it("tolera amanhã por causa do fuso, mas não depois", () => {
    expect(validarEntrada({ ...base, collectionDate: "2026-10-24" }, HOJE).ok).toBe(true);
    expect(validarEntrada({ ...base, collectionDate: "2026-10-25" }, HOJE).ok).toBe(false);
  });

  it("recusa valor negativo, texto no valor e volume absurdo", () => {
    expect(validarEntrada({ ...base, amount: "-5" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, amount: "abc" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, volumeLiters: 99999 }, HOJE).ok).toBe(false);
  });
});

describe("validarEntrada: entradas hostis", () => {
  it("recusa valor negativo vindo como número JSON, não só como texto", () => {
    expect(validarEntrada({ ...base, amount: -140 }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, volumeLiters: -70 }, HOJE).ok).toBe(false);
  });

  it("recusa mais de duas casas em vez de arredondar em ponto flutuante", () => {
    expect(validarEntrada({ ...base, amount: "1,005" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, volumeLiters: 70.005 }, HOJE).ok).toBe(false);
  });

  it("recusa datas fora da faixa que a tela consegue listar", () => {
    expect(validarEntrada({ ...base, collectionDate: "0001-01-01" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, collectionDate: "2023-12-31" }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, collectionDate: "2026-10-23lixo" }, HOJE).ok).toBe(false);
  });

  it("recusa campos de texto que não são texto", () => {
    expect(validarEntrada({ ...base, collectorName: {} }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, notes: ["a", "b"] }, HOJE).ok).toBe(false);
    expect(validarEntrada({ ...base, collectionDate: 20261023 }, HOJE).ok).toBe(false);
  });

  it("guarda o certificado em caixa alta", () => {
    const r = validarEntrada({ ...base, certificateNumber: "ab-12" }, HOJE);
    expect(r.ok && r.dados.certificateNumber).toBe("AB-12");
  });
});

describe("coletor e datas relativas a hoje", () => {
  it("variações de Retióleo viram o mesmo coletor; outro nome é mantido", () => {
    expect(normalizarColetor("  retioleo ")).toBe("Retióleo");
    expect(normalizarColetor("RETIÓLEO")).toBe("Retióleo");
    expect(normalizarColetor("Óleo  Verde   Ltda")).toBe("Óleo Verde Ltda");
  });

  it("às 22h de São Paulo o dia ainda é o de São Paulo, não o do UTC", () => {
    expect(hojeEmSaoPaulo(new Date("2026-10-24T01:00:00Z"))).toBe("2026-10-23");
    expect(hojeEmSaoPaulo(new Date("2026-10-24T03:30:00Z"))).toBe("2026-10-24");
  });

  it("aceita até amanhã e recusa depois", () => {
    expect(passaDeAmanha("2026-10-24", HOJE)).toBe(false);
    expect(passaDeAmanha("2026-10-25", HOJE)).toBe(true);
  });
});

describe("lerNumero e dataIsoValida", () => {
  it("lê número com ponto ou vírgula e recusa lixo", () => {
    expect(lerNumero("12,5")).toBe(12.5);
    expect(lerNumero("12.5")).toBe(12.5);
    expect(lerNumero("1.250,00")).toBeNull();
    expect(lerNumero(-1)).toBeNull();
    expect(lerNumero("-1")).toBeNull();
    expect(lerNumero({})).toBeNull();
    expect(lerNumero(null)).toBeNull();
  });

  it("só aceita a data pura AAAA-MM-DD", () => {
    expect(dataIsoValida("2026-10-23")).toBe("2026-10-23");
    expect(dataIsoValida("2026-10-23T00:00:00.000Z")).toBeNull();
    expect(dataIsoValida("23/10/2026")).toBeNull();
  });
});

describe("situacaoDaColeta", () => {
  it("o PIX segue o status do título no Contas a Receber", () => {
    expect(situacaoDaColeta(false, "OPEN")).toBe("PENDING");
    expect(situacaoDaColeta(false, "PARTIALLY_RECEIVED")).toBe("PARTIAL");
    expect(situacaoDaColeta(false, "RECEIVED")).toBe("RECEIVED");
  });

  it("cancelada aqui, ou título cancelado lá, sai de tudo", () => {
    expect(situacaoDaColeta(true, "OPEN")).toBe("CANCELLED");
    expect(situacaoDaColeta(false, "CANCELLED")).toBe("CANCELLED");
  });

  it("título que sumiu segue como pendente em vez de esconder a coleta", () => {
    expect(situacaoDaColeta(false, null)).toBe("PENDING");
  });
});

describe("descricaoDoTitulo", () => {
  it("identifica coletor, certificado e volume", () => {
    expect(descricaoDoTitulo({ collectorName: "Retióleo", certificateNumber: "107257", volumeLiters: 70 })).toBe("Coleta de óleo · Retióleo · CDF 107257 · 70 L");
    expect(descricaoDoTitulo({ collectorName: "Retióleo", certificateNumber: null, volumeLiters: 65.5 })).toBe("Coleta de óleo · Retióleo · 65,5 L");
  });
});

describe("resumir", () => {
  const coletas = [
    { collectionDate: "2026-10-23", volumeLiters: 70, amount: 140, paidAmount: 0, status: "PENDING" },
    { collectionDate: "2026-10-16", volumeLiters: 50, amount: 100, paidAmount: 60, status: "PARTIAL" },
    { collectionDate: "2026-10-09", volumeLiters: 60, amount: 120, paidAmount: 120, status: "RECEIVED" },
    { collectionDate: "2026-09-25", volumeLiters: 50, amount: 100, paidAmount: 100, status: "RECEIVED" },
    { collectionDate: "2026-09-10", volumeLiters: 999, amount: 999, paidAmount: 0, status: "CANCELLED" }
  ];

  it("soma só as não canceladas; o recebido é o que foi baixado e o pendente é o que falta", () => {
    const r = resumir(coletas);
    expect(r).toMatchObject({ collections: 4, liters: 230, amount: 460, pendingCount: 2, pendingAmount: 180, receivedCount: 2, receivedAmount: 280, lastCollectionDate: "2026-10-23" });
    expect(r.pricePerLiter).toBe(2);
  });

  it("agrupa por mês, do mais recente para o mais antigo", () => {
    expect(resumir(coletas).months).toEqual([
      { month: "2026-10", collections: 3, liters: 180, amount: 360 },
      { month: "2026-09", collections: 1, liters: 50, amount: 100 }
    ]);
  });

  it("baixa maior que o valor não gera pendência negativa", () => {
    expect(resumir([{ collectionDate: "2026-10-01", volumeLiters: 10, amount: 20, paidAmount: 25, status: "PARTIAL" }]).pendingAmount).toBe(0);
  });

  it("lista vazia não divide por zero", () => {
    expect(resumir([])).toMatchObject({ collections: 0, pricePerLiter: null, lastCollectionDate: null, months: [] });
  });
});
