import { describe, expect, it } from "vitest";
import type { ReimbursementDetail } from "../../../api/client";
import { montarPdfReembolso, nomeArquivoReembolso, ordenarCompras, periodoDoReembolso } from "../pdfReembolso";

const item = (id: string, purchaseDate: string, storeName: string, amount = "10.00"): ReimbursementDetail["items"][number] => ({
  id, purchaseId: `p-${id}`, amount, purchaseDate, checked: true, purchaseNumber: "C-1", invoiceNumber: null,
  isSmallExpense: false, purchaseStatus: "PAID", storeName, firstItemName: "Gelo", itemLines: 2,
});

const detalhe = (items: ReimbursementDetail["items"]): ReimbursementDetail => ({
  id: "abcdef123456", payeeSupplierId: "s1", payeeName: "João da Conceição", status: "CLOSED",
  totalAmount: "30.00", dueDate: "2026-11-30", closedAt: null, generatedPurchaseId: null, createdAt: "2026-11-01",
  notes: "Compras da festa", items, installments: [],
} as ReimbursementDetail);

describe("pdfReembolso", () => {
  it("ordena da compra mais antiga para a mais nova, sem alterar a lista original", () => {
    const original = [item("2", "2026-11-10T00:00:00Z", "B"), item("1", "2026-11-03T00:00:00Z", "A")];
    expect(ordenarCompras(original).map((i) => i.id)).toEqual(["1", "2"]);
    expect(original[0].id).toBe("2");
  });

  it("resume o período em uma data ou em um intervalo", () => {
    expect(periodoDoReembolso([])).toBe("-");
    expect(periodoDoReembolso([item("1", "2026-11-03T00:00:00Z", "A")])).toBe("03/11/2026");
    expect(periodoDoReembolso([item("1", "2026-11-20T00:00:00Z", "A"), item("2", "2026-11-03T00:00:00Z", "B")])).toBe("03/11/2026 a 20/11/2026");
  });

  it("tira acento e símbolos do nome do arquivo", () => {
    expect(nomeArquivoReembolso({ payeeName: "João da Conceição", id: "abcdef123456" })).toBe("Reembolso_Joao_da_Conceicao_123456.pdf");
  });

  it("monta o PDF com a tabela e as assinaturas", async () => {
    const doc = await montarPdfReembolso(detalhe([item("1", "2026-11-03T00:00:00Z", "Atacadão"), item("2", "2026-11-10T00:00:00Z", "Mercado")]));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("não quebra com muitas compras (várias páginas)", async () => {
    const muitas = Array.from({ length: 80 }, (_, i) => item(String(i), `2026-11-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, `Loja ${i}`));
    const doc = await montarPdfReembolso(detalhe(muitas));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
