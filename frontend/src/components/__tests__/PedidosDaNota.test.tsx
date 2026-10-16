import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ItemEmAberto } from "../../lib/vinculoPedido";

const getPedidosEmAbertoParaNota = vi.fn();
// A falha vem de fora do espião: o vi.fn anexa um .then sem tratamento de erro a toda Promise rejeitada que retorna.
let servidorForaDoAr = false;
vi.mock("../../api/client", () => ({
  getPedidosEmAbertoParaNota: (...args: unknown[]) => (servidorForaDoAr ? Promise.reject(new Error("Servidor fora do ar")) : getPedidosEmAbertoParaNota(...args))
}));

import { PedidosDaNota } from "../PedidosDaNota";

const item = (over: Partial<ItemEmAberto>): ItemEmAberto => ({
  purchaseOrderItemId: "i1", orderId: "o1", orderCode: "PC-2026-0001", orderStatus: "RASCUNHO", orderCreatedAt: "2026-09-01T00:00:00.000Z",
  productId: "p1", productName: "Tomate", unit: "KG", pedida: 5, restante: 5, vinculada: null, unidadeCompativel: true, ...over
});

const itensDaNota = [{ productId: "p1", quantity: 7 }];

beforeEach(() => {
  getPedidosEmAbertoParaNota.mockReset();
  servidorForaDoAr = false;
});

describe("PedidosDaNota", () => {
  test("sem pedido em aberto não mostra nada", async () => {
    getPedidosEmAbertoParaNota.mockResolvedValue({ items: [] });
    const { container } = render(<PedidosDaNota supplierId="f1" purchaseId={null} itensDaNota={itensDaNota} valor={{}} onChange={vi.fn()} />);
    await waitFor(() => expect(getPedidosEmAbertoParaNota).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test("lista o pedido, avisa que o rascunho passa a Enviado e marca a quantidade que falta", async () => {
    getPedidosEmAbertoParaNota.mockResolvedValue({ items: [item({})] });
    const onChange = vi.fn();
    render(<PedidosDaNota supplierId="f1" purchaseId={null} itensDaNota={itensDaNota} valor={{}} onChange={onChange} />);
    expect(await screen.findByText("PC-2026-0001")).toBeInTheDocument();
    expect(screen.getByText(/passa a Enviado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith({ i1: "5" }, true);
  });

  test("a sugestão reparte entre dois pedidos, o mais antigo primeiro", async () => {
    getPedidosEmAbertoParaNota.mockResolvedValue({
      items: [
        item({ purchaseOrderItemId: "novo", orderId: "o2", orderCode: "PC-NOVO", orderCreatedAt: "2026-09-10T00:00:00.000Z", restante: 4 }),
        item({ purchaseOrderItemId: "antigo", restante: 3 })
      ]
    });
    const onChange = vi.fn();
    render(<PedidosDaNota supplierId="f1" purchaseId={null} itensDaNota={itensDaNota} valor={{}} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: /Sugerir/ }));
    expect(onChange).toHaveBeenLastCalledWith({ antigo: "3", novo: "4" }, true);
  });

  test("editando a compra, os vínculos que ela já tem voltam preenchidos", async () => {
    getPedidosEmAbertoParaNota.mockResolvedValue({ items: [item({ vinculada: 2, restante: 0 })] });
    const onChange = vi.fn();
    render(<PedidosDaNota supplierId="f1" purchaseId="c1" itensDaNota={itensDaNota} valor={{}} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ i1: "2" }, true));
  });

  test("avisa quando a soma ligada passa do que a nota trouxe", async () => {
    getPedidosEmAbertoParaNota.mockResolvedValue({ items: [item({})] });
    render(<PedidosDaNota supplierId="f1" purchaseId={null} itensDaNota={[{ productId: "p1", quantity: 2 }]} valor={{ i1: "5" }} onChange={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/Tomate/);
  });

  test("falha ao carregar mostra o motivo e não deixa gravar vínculo às cegas", async () => {
    servidorForaDoAr = true;
    const onChange = vi.fn();
    render(<PedidosDaNota supplierId="f1" purchaseId={null} itensDaNota={itensDaNota} valor={{}} onChange={onChange} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Servidor fora do ar");
    expect(onChange).not.toHaveBeenCalled();
  });
});
