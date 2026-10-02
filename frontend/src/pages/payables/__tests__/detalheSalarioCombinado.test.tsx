import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Payable } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { DetalheSimples } from "../DetalheSimples";

// Detalhe do salário no Contas a Pagar: quem tem salário combinado recebe o valor integral,
// e a janela mostra de onde ele vem (líquido do extrato + diferença do combinado).
const titulo = (over: Partial<Payable> = {}): Payable => ({
  id: "p1", purchaseId: null, dueDate: "2026-10-05T00:00:00.000Z", paidDate: null, amount: "5954.74", paidAmount: null,
  installment: null, paymentMethodId: null, paymentMethodName: null, sourceType: "PAYROLL", status: "OPEN", rawValue: null,
  supplierId: null, supplierName: "Elioenai Silva", purchaseNumber: null, invoiceNumber: null, purchaseDate: null, notes: null,
  taxDocumentType: "Salário", taxDescription: "Extrato 09/2026", taxCompanyName: "Elioenai Silva",
  ...over,
});
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = (t: Payable) => render(
  <SessionContext.Provider value={SESSAO}>
    <HideValuesProvider>
      <DetalheSimples titulo={t} historico={[]} notice={null} excluirMotivo={null} excluindo={false} podeGerir
        onMotivo={vi.fn()} onExcluir={vi.fn()} onFechar={vi.fn()} />
    </HideValuesProvider>
  </SessionContext.Provider>,
);
const texto = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("DetalheSimples — salário combinado", () => {
  test("mostra a composição: líquido do extrato + diferença do combinado = total", () => {
    abrir(titulo({
      salarioComposicao: { tipo: "SALARIO_COMBINADO", liquidoExtrato: 3030, complemento: 2924.74, total: 5954.74, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54 },
    }));
    expect(screen.getByRole("heading", { name: "Salário combinado" })).toBeInTheDocument();
    const t = texto();
    expect(t).toMatch(/Líquido do extrato R\$ ?3\.030,00 \+ diferença do salário combinado R\$ ?2\.924,74 = R\$ ?5\.954,74/);
    expect(t).toMatch(/\(R\$ ?5\.200,00 − adiantamento R\$ ?1\.468,80\) \+ gorjeta R\$ ?2\.223,54/);
  });

  test("gorjeta ainda não apurada: avisa que foi lançado o líquido do extrato", () => {
    abrir(titulo({
      amount: "3030",
      salarioComposicao: { tipo: "PENDENTE_GORJETA", liquidoExtrato: 3030, complemento: 0, total: 3030, combinado: 5200, adiantamento: null, gorjetaIntegral: null },
    }));
    expect(texto()).toContain("Gorjeta do mês ainda não apurada: lançado só o líquido do extrato. Será atualizado ao fechar a gorjeta.");
  });

  test("sem composição (lançamento comum ou sem permissão de ver salários): nada a mais", () => {
    abrir(titulo({ salarioComposicao: null }));
    expect(screen.queryByRole("heading", { name: "Salário combinado" })).not.toBeInTheDocument();
  });
});
