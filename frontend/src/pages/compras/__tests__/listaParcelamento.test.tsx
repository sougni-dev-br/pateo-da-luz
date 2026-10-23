import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Purchase } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
vi.mock("../../../context/SessionContext", () => ({ useSession: () => ({ user: { id: "u1", role: "ADMIN", permissions: {} } }) }));

import { ListaCompras, type AcoesLista, type LinhaCompra } from "../ListaCompras";

// Dados fictícios. Parcela de parcelamento em lote não se edita nem cancela como compra comum.

const acoes = (): AcoesLista => ({
  podeCriar: true, podeEditar: true, podeCancelar: true,
  onVer: vi.fn(), onEditar: vi.fn(), onCopiar: vi.fn(), onCancelar: vi.fn(), onRestaurar: vi.fn(),
  onAbrirParcelamento: vi.fn(), onNova: vi.fn()
});

const compra = (over: Partial<Purchase> = {}) => ({
  id: "c1", supplierId: "s1", purchaseDate: "2026-11-10", competenceMonth: 11, competenceYear: 2026, invoiceNumber: "NF1",
  rawSupplierCode: null, paymentMethod: "BOLETO", paymentMethodId: null, totalAmount: "100.00", status: "ACTIVE",
  supplier: { id: "s1", name: "Fornecedor Fictício" }, items: [], installments: [], ...over
}) as unknown as Purchase;

const linha = (c: Purchase): LinhaCompra => ({ compra: c, vencimento: { tom: "neutro", texto: "10/11" } as never });

const desenhar = (c: Purchase, a = acoes()) => {
  render(<HideValuesProvider><ListaCompras linhas={[linha(c)]} acoes={a} /></HideValuesProvider>);
  return a;
};

const abrirMenu = () => fireEvent.pointerDown(screen.getAllByRole("button", { name: /Mais ações/ })[0], { button: 0, pointerType: "mouse" });

describe("ListaCompras e parcelas de parcelamento", () => {
  test("compra comum mostra Editar e Cancelar", () => {
    desenhar(compra());
    expect(screen.getAllByRole("button", { name: /Editar/ }).length).toBeGreaterThan(0);
    abrirMenu();
    expect(screen.getAllByText("Cancelar compra").length).toBeGreaterThan(0);
  });

  test("parcela de parcelamento não oferece Editar nem Cancelar e leva ao parcelamento", () => {
    const a = desenhar(compra({ installmentPlanId: "pl1", planInstallmentNumber: 2 }));
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    abrirMenu();
    expect(screen.queryByText("Cancelar compra")).toBeNull();
    fireEvent.click(screen.getByText("Abrir em Parcelamentos"));
    expect(a.onAbrirParcelamento).toHaveBeenCalled();
  });

  test("parcela cancelada de parcelamento também não oferece Restaurar", () => {
    desenhar(compra({ installmentPlanId: "pl1", planInstallmentNumber: 2, status: "CANCELLED" }));
    abrirMenu();
    expect(screen.queryByText("Restaurar")).toBeNull();
  });
});
