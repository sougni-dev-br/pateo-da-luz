import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SupplierHistory, SupplierHistoryPurchase, SupplierHistoryTitle } from "../../api/client";

// A tabela que iria para o PDF e o nome do arquivo, sem gerar arquivo de verdade.
const tabelas: Array<{ head: string[][]; body: string[][] }> = [];
const salvos: string[] = [];
const opcoesDoDocumento: Array<{ orientation: string; format: string }> = [];
vi.mock("jspdf", () => ({
  jsPDF: class {
    lastAutoTable = { finalY: 50 };
    // A4 em paisagem.
    internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    constructor(opcoes: { orientation: string; format: string }) { opcoesDoDocumento.push(opcoes); }
    setFont() {} setFontSize() {} setTextColor() {} setDrawColor() {} setFillColor() {} setLineWidth() {}
    line() {} rect() {} roundedRect() {} addPage() {} setPage() {} text() {}
    save(nome: string) { salvos.push(nome); }
    getNumberOfPages() { return 1; }
    getTextWidth(t: string) { return t.length * 1.5; }
    splitTextToSize(t: string) { return [t]; }
  }
}));
vi.mock("jspdf-autotable", () => ({
  default: (_doc: unknown, o: { head: string[][]; body: string[][] }) => { tabelas.push(o); }
}));
import { descreverFiltrosPdf, gerarPdfHistoricoFornecedor, linhasHistoricoPdf } from "../supplierHistoryPdf";

const titulo = (over: Partial<SupplierHistoryTitle>): SupplierHistoryTitle => ({
  state: "OPEN", parcels: [], installments: 1, paidInstallments: 0, amount: 0, paidAmount: 0, nextDueDate: null, paidDate: null, viaCycle: false, ...over
});

const compra = (over: Partial<SupplierHistoryPurchase>): SupplierHistoryPurchase => ({
  id: "c", purchaseNumber: "CMP-1", invoiceNumber: "1208953", purchaseDate: "2026-11-23T00:00:00.000Z", totalAmount: "5000.50",
  status: "ACTIVE", paymentMethod: "BOLETO 2X", title: titulo({}), ...over
});

const parcelada = compra({
  title: titulo({
    state: "OVERDUE", installments: 2, paidInstallments: 1, nextDueDate: "2026-11-30",
    parcels: [
      { number: 1, dueDate: "2026-11-10", amount: 2500.25, state: "PAID", paidDate: "2026-11-09", paidAmount: 2500.25 },
      { number: 2, dueDate: "2026-11-30", amount: 2500.25, state: "OVERDUE", paidDate: null, paidAmount: 0 }
    ]
  })
});

const historico = (itens: SupplierHistoryPurchase[], over: Partial<SupplierHistory> = {}): SupplierHistory => ({
  period: { from: "2026-11-01", to: "2026-11-30" },
  periodTotal: 6000, purchaseCount: 2, lastPurchase: null, averagePaymentTermDays: null,
  purchases: { items: itens, total: itens.length, page: 1, pageSize: 2000, truncated: false },
  titleBuckets: { all: { count: 2, amount: 6000 }, open: { count: 1, amount: 1000 }, overdue: { count: 1, amount: 5000.5 }, paid: { count: 0, amount: 0 }, none: { count: 0, amount: 0 } },
  paymentMethods: [],
  ...over
});

beforeEach(() => { tabelas.length = 0; salvos.length = 0; opcoesDoDocumento.length = 0; });

describe("linhas do PDF", () => {
  test("colunas: data da compra, NF/pedido, forma de pagamento, total, vencimento e status", () => {
    const linhas = linhasHistoricoPdf([compra({ title: titulo({ state: "OPEN", parcels: [{ number: 1, dueDate: "2026-12-05", amount: 5000.5, state: "OPEN", paidDate: null, paidAmount: 0 }] }) })]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].celulas).toEqual(["23/11/2026", "1208953\nCMP-1", "BOLETO 2X", expect.stringContaining("5.000,50"), "05/12/2026", "Em aberto"]);
    expect(linhas[0].tom).toBe("neutro");
  });

  test("compra parcelada se repete uma vez por parcela, com 1/2 e 2/2, o vencimento e o status de cada uma", () => {
    const linhas = linhasHistoricoPdf([parcelada]);
    expect(linhas).toHaveLength(2);
    // A compra (data, NF, pedido) se repete; o que muda é a parcela.
    expect(linhas.map((l) => l.celulas.slice(0, 2))).toEqual([["23/11/2026", "1208953\nCMP-1"], ["23/11/2026", "1208953\nCMP-1"]]);
    expect(linhas.map((l) => l.celulas[2])).toEqual(["BOLETO 2X\nParcela 1/2", "BOLETO 2X\nParcela 2/2"]);
    expect(linhas[0].celulas[3]).toMatch(/^R\$\s2\.500,25\nde R\$\s5\.000,50$/);
    expect(linhas.map((l) => l.celulas[4])).toEqual(["10/11/2026", "30/11/2026"]);
    expect(linhas.map((l) => l.celulas[5])).toEqual(["Pago\nem 09/11/2026", "Em aberto"]);
    expect(linhas[0]).toMatchObject({ tom: "ok", continuacao: false });
    expect(linhas[1]).toMatchObject({ tom: "vencido", continuacao: true });
  });

  test("o status só tem dois valores: Pago ou Em aberto (vencido é Em aberto, em vermelho)", () => {
    const status = linhasHistoricoPdf([parcelada]).map((l) => l.celulas[5].split("\n")[0]);
    expect(status).toEqual(["Pago", "Em aberto"]);
    expect(linhasHistoricoPdf([parcelada])[1].tom).toBe("vencido");
  });

  test("compra de ciclo fica numa linha só, com o próximo vencimento do título do ciclo", () => {
    const doCiclo = compra({ title: { ...parcelada.title, viaCycle: true } });
    const linhas = linhasHistoricoPdf([doCiclo]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].celulas[4]).toBe("30/11/2026");
    expect(linhas[0].celulas[5]).toBe("Em aberto\nTítulo do ciclo");
  });

  test("compra sem título não inventa vencimento nem status de pagamento", () => {
    const semTitulo = compra({ title: titulo({ state: "NONE", installments: 0 }) });
    expect(linhasHistoricoPdf([semTitulo])[0].celulas.slice(4)).toEqual(["-", "Sem título"]);
  });

  test("cancelada mostra só o status, sem vencimento", () => {
    const linhas = linhasHistoricoPdf([compra({ status: "CANCELLED", title: parcelada.title })]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ tipo: "cancelada" });
    expect(linhas[0].celulas.slice(4)).toEqual(["-", "Cancelada"]);
  });
});
describe("filtros descritos no cabeçalho", () => {
  const base = { supplierName: "X", titleFilter: "all" as const, search: "", includeCancelled: false };

  test("período e filtros ativos", () => {
    expect(descreverFiltrosPdf({ from: "2026-11-01", to: "2026-11-30" }, base)).toBe("01/11/2026 a 30/11/2026");
    expect(descreverFiltrosPdf({ from: null, to: null }, { ...base, titleFilter: "overdue", search: "1208", includeCancelled: true }))
      .toBe("Todo o histórico   |   Situação: Vencidas   |   Busca: 1208   |   Inclui canceladas");
  });
});

describe("gerarPdfHistoricoFornecedor", () => {
  test("monta a tabela com cabeçalho fixo e salva com o nome do fornecedor", async () => {
    await gerarPdfHistoricoFornecedor(historico([parcelada]), { supplierName: "CASTELÃO Frios", titleFilter: "all", search: "", includeCancelled: false }, new Date(2026, 10, 24));
    expect(tabelas).toHaveLength(1);
    expect(tabelas[0].head[0]).toEqual(["Data da compra", "NF, Pedido", "Forma de pagamento", "Total", "Data de vencimento", "Status"]);
    expect(tabelas[0].body).toHaveLength(2);
    expect(salvos).toEqual(["Historico_CASTELAO_Frios_2026-11-24.pdf"]);
  });

  test("sai em A4 paisagem", async () => {
    await gerarPdfHistoricoFornecedor(historico([parcelada]), { supplierName: "X", titleFilter: "all", search: "", includeCancelled: false });
    expect(opcoesDoDocumento).toEqual([expect.objectContaining({ orientation: "landscape", format: "a4" })]);
  });
});
