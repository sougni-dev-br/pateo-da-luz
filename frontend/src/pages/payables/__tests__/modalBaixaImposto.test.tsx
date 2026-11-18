import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Payable } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system/context/HideValuesContext";
import { ModalBaixa, type FormBaixa } from "../ModalBaixa";

const imposto = (over: Partial<Payable> = {}): Payable => ({
  id: "g1", purchaseId: null, dueDate: "2026-11-19T00:00:00.000Z", paidDate: null, amount: "1500.00", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "TAX_PAYMENT", status: "OPEN", rawValue: null,
  supplierId: null, supplierName: null, purchaseNumber: null, invoiceNumber: null, purchaseDate: null, notes: null,
  taxDocumentType: "DARF", taxDescription: null, taxCompanyName: "Empresa Exemplo",
  ...over,
} as Payable);

const form = (over: Partial<FormBaixa> = {}): FormBaixa => ({
  paidDate: "2026-11-18", paidAmount: "1500.00", paidPaymentMethod: "", paymentNotes: "", differenceReason: "",
  payingCompanyId: "", companyBankAccountId: "", ...over,
});

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;

function abrir(f: FormBaixa) {
  return render(
    <SessionContext.Provider value={SESSAO}><HideValuesProvider>
      <ModalBaixa paying={imposto()} form={f} onCampo={vi.fn()} onEmpresa={vi.fn()} formas={[]} companies={[]} bankAccounts={[]}
        notice={null} enviando={false} onFechar={vi.fn()} onConfirmar={vi.fn()} />
    </HideValuesProvider></SessionContext.Provider>,
  );
}

describe("ModalBaixa de imposto: a diferença do valor pago aparece", () => {
  test("igual ao valor da guia: diz que não há diferença", () => {
    abrir(form());
    expect(screen.getByText("Sem diferença em relação ao valor original")).toBeTruthy();
  });

  test("pago a mais (juros e multa): mostra o acréscimo, sem exigir justificativa (rotina no imposto)", () => {
    abrir(form({ paidAmount: "1600.00" }));
    expect(screen.getByText(/Juros \/ acréscimo/)).toBeTruthy();
    expect(screen.queryByText(/Justificativa da diferença/)).toBeNull();
  });

  test("pago a menos: mostra o desconto", () => {
    abrir(form({ paidAmount: "1450.00" }));
    expect(screen.getByText(/Desconto/)).toBeTruthy();
  });
});
