import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getPurchaseOrder = vi.fn();
const changePurchaseOrderStatus = vi.fn();
const downloadPurchaseOrderPdf = vi.fn();
const getPurchaseOrderPdfBlob = vi.fn();

vi.mock("../../api/client", () => ({
  getPurchaseOrder: (...args: unknown[]) => getPurchaseOrder(...args),
  changePurchaseOrderStatus: (...args: unknown[]) => changePurchaseOrderStatus(...args),
  downloadPurchaseOrderPdf: (...args: unknown[]) => downloadPurchaseOrderPdf(...args),
  getPurchaseOrderPdfBlob: (...args: unknown[]) => getPurchaseOrderPdfBlob(...args)
}));

import { EnvioDoPedido } from "../EnvioDoPedido";

const pedido = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "o1", code: "PC-2026-0001", status, supplierNameSnapshot: "Moinho Bom", supplierPhone: "(11) 98765-4321", supplierEmail: "compras@moinho.com",
  supplierContactName: "Carlos", expectedDeliveryDate: null, items: [{ productNameSnapshot: "FARINHA", requestedQuantity: "20", unitSnapshot: "KG" }], ...extra
});

describe("EnvioDoPedido", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

  test("rascunho: aprovar passa por revisão e aprovação, em ordem, e libera o envio", async () => {
    getPurchaseOrder.mockResolvedValue(pedido("RASCUNHO"));
    changePurchaseOrderStatus.mockImplementation(async (_id: string, acao: string) => pedido(acao === "APPROVE" ? "APROVADO" : "EM_REVISAO"));
    render(<EnvioDoPedido orderId="o1" canApprove />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar para envio" }));
    await waitFor(() => expect(changePurchaseOrderStatus.mock.calls.map((c) => c[1])).toEqual(["SEND_REVIEW", "APPROVE"]));
    expect(await screen.findByRole("link", { name: /WhatsApp/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Marcar como enviado" })).toBeTruthy();
  });

  test("quem não aprova vê o botão desligado e o motivo, e não manda rascunho ao fornecedor", async () => {
    getPurchaseOrder.mockResolvedValue(pedido("RASCUNHO"));
    render(<EnvioDoPedido orderId="o1" canApprove={false} />);
    expect((await screen.findByRole("button", { name: "Aprovar para envio" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Precisa de quem aprova/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
  });

  test("aprovado: WhatsApp com o telefone do fornecedor e a mensagem com os itens; e-mail em mailto", async () => {
    getPurchaseOrder.mockResolvedValue(pedido("APROVADO"));
    render(<EnvioDoPedido orderId="o1" canApprove />);
    const whatsapp = (await screen.findByRole("link", { name: /WhatsApp/ })) as HTMLAnchorElement;
    expect(whatsapp.href).toContain("https://wa.me/5511987654321?text=");
    expect(decodeURIComponent(whatsapp.href)).toContain("20 KG — FARINHA");
    expect(whatsapp.rel).toContain("noopener");
    expect((screen.getByRole("link", { name: /E-mail/ }) as HTMLAnchorElement).href).toMatch(/^mailto:compras@moinho\.com/);
  });

  test("fornecedor sem telefone: dá para digitar o número na hora e o link do WhatsApp aparece; sem e-mail, avisa", async () => {
    getPurchaseOrder.mockResolvedValue(pedido("APROVADO", { supplierPhone: null, supplierEmail: null }));
    render(<EnvioDoPedido orderId="o1" canApprove />);
    const campo = await screen.findByLabelText("Número do WhatsApp do fornecedor");
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    fireEvent.change(campo, { target: { value: "(11) 91234-5678" } });
    expect(((await screen.findByRole("link", { name: /WhatsApp/ })) as HTMLAnchorElement).href).toContain("https://wa.me/5511912345678");
    expect(screen.getByText(/E-mail indisponível/)).toBeTruthy();
  });

  test("baixar o PDF e marcar como enviado", async () => {
    getPurchaseOrder.mockResolvedValue(pedido("APROVADO"));
    changePurchaseOrderStatus.mockResolvedValue(pedido("ENVIADO"));
    render(<EnvioDoPedido orderId="o1" canApprove />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar PDF" }));
    await waitFor(() => expect(downloadPurchaseOrderPdf).toHaveBeenCalledWith("o1", "PC-2026-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviado" }));
    await waitFor(() => expect(changePurchaseOrderStatus).toHaveBeenCalledWith("o1", "MARK_SENT"));
    expect(await screen.findByText("Enviado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Marcar como enviado" })).toBeNull();
  });

  test("erro ao aprovar aparece e o pedido continua como estava", async () => {
    getPurchaseOrder.mockResolvedValue(pedido("RASCUNHO"));
    changePurchaseOrderStatus.mockRejectedValue(new Error("Usuario sem permissao para aprovar pedido de compra."));
    render(<EnvioDoPedido orderId="o1" canApprove />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar para envio" }));
    expect(await screen.findByText(/sem permissao para aprovar/)).toBeTruthy();
    expect(screen.getByText("Rascunho")).toBeTruthy();
  });
});
