import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { DetalheSimples } from "../DetalheSimples";
import { ModalBaixaLote } from "../ModalBaixaLote";

const titulo = (over: Partial<Payable> = {}): Payable => ({
  id: "p1", purchaseId: null, dueDate: "2026-10-05T00:00:00.000Z", paidDate: null, amount: "120", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "PAYROLL", status: "OPEN", rawValue: null,
  supplierId: null, supplierName: "Ana", purchaseNumber: null, invoiceNumber: null, purchaseDate: null, notes: null,
  taxDocumentType: "VT", taxDescription: null, taxCompanyName: "Ana",
  ...over,
} as Payable);
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const comSessao = (ui: React.ReactElement) => render(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("DetalheSimples — excluir lançamento só para quem gere", () => {
  const abrir = (podeGerir: boolean) => comSessao(
    <DetalheSimples titulo={titulo()} historico={[]} notice={null} excluirMotivo={null} excluindo={false} podeGerir={podeGerir}
      onMotivo={vi.fn()} onExcluir={vi.fn()} onFechar={vi.fn()} />,
  );
  test("com permissão de editar: o botão aparece", () => {
    abrir(true);
    expect(screen.getByRole("button", { name: "Excluir lançamento" })).toBeInTheDocument();
  });
  test("só leitura: nada de excluir", () => {
    abrir(false);
    expect(screen.queryByRole("button", { name: "Excluir lançamento" })).not.toBeInTheDocument();
    expect(screen.queryByText("Não vai ser pago?")).not.toBeInTheDocument();
  });
});

describe("ModalBaixaLote — título depois de enviar", () => {
  test("com resultado (seleção já limpa): conta o que foi enviado, não 0", () => {
    comSessao(
      <ModalBaixaLote selecionados={[]} total={0}
        form={{ paidDate: "2026-10-01", paidAmount: "", paidPaymentMethod: "", paymentNotes: "", differenceReason: "", payingCompanyId: "", companyBankAccountId: "" }}
        onCampo={vi.fn()} onEmpresa={vi.fn()} formas={[]} companies={[]} notice={null} ocupado={false}
        resultado={{ ok: 2, erros: [{ nome: "Beto", motivo: "período fechado" }] }}
        onFechar={vi.fn()} onFecharResultado={vi.fn()} onConfirmar={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Baixar 3 título(s)" })).toBeInTheDocument();
    expect(screen.queryByText(/Baixar 0/)).not.toBeInTheDocument();
  });
});
