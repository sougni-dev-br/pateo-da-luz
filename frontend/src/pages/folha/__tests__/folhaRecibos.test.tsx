import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import type { PayrollList, PayrollListItem, ReciboPagoAntes } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getPayroll: vi.fn(), getPayrollSettings: vi.fn(async () => { throw new Error("sem"); }), getVtFares: vi.fn(async () => []),
  getEmployees: vi.fn(async () => []), getRecibosPagoAntes: vi.fn(),
}));
vi.mock("../../gorjeta/reciboPagamento", () => ({ imprimirRecibosPagamento: vi.fn(async () => "blob:recibo") }));

import { getPayroll, getRecibosPagoAntes } from "../../../api/client";
import { imprimirRecibosPagamento } from "../../gorjeta/reciboPagamento";
import { Folha } from "../../Folha";

// Recibos da 1ª quinzena e do adiantamento dos sem registro na lista da Folha. Dados fictícios.
beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });

const item = (over: Partial<PayrollListItem>): PayrollListItem => ({
  id: "i", employeeName: "Pessoa", employeeDisplayName: null, sector: null, type: "ADIANTAMENTO", periodLabel: "Adiantamento",
  periodStart: null, periodEnd: null, dueDate: "2026-09-20T00:00:00.000Z", amount: "1040.00", workedDays: null, freeDays: null,
  paymentDate: null, paidAmount: null, status: "PENDING", dreCategoryId: null, details: null, ...over,
});
const LISTA = {
  year: 2026, month: 9,
  items: [
    item({ id: "q1", employeeName: "Ana Exemplo", periodLabel: "1ª quinzena", amount: "1300.00", details: { semRegistro: true, primeiraQuinzena: true } }),
    item({ id: "a1", employeeName: "Bia Exemplo", details: { semRegistro: true } }),
    item({ id: "c1", employeeName: "Caio Exemplo", details: { base: 3000, percent: 40 } }),
  ],
  summary: { total: 0, vt: 0, advance: 0, salary: 0, ferias: 0, paid: 0, pending: 0, overdue: 0, count: 3 },
} as PayrollList;

const sessao = (comFuncionarios: boolean): SessionContextValue => ({
  user: comFuncionarios
    ? { id: "u1", name: "Fulano", role: "ADMIN", permissions: {} }
    : { id: "u2", name: "Beltrano", role: "VISUALIZACAO", modulePermissions: { payroll: { view: true } } },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue);
const render = (ui: ReactElement, s: SessionContextValue) => renderRaw(<SessionContext.Provider value={s}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("recibos na Folha", () => {
  test("um por lançamento (quinzena e adiantamento do sem registro; CLT não) e todos do mês por tipo", async () => {
    vi.mocked(getPayroll).mockResolvedValue(LISTA);
    const quinzena = { tipo: "QUINZENA", id: "q1", total: 1300 } as ReciboPagoAntes;
    const adiantamento = { tipo: "ADIANTAMENTO", id: "a1", total: 1040 } as ReciboPagoAntes;
    vi.mocked(getRecibosPagoAntes).mockResolvedValue({ competencia: "09/2026", recibos: [quinzena, adiantamento] });
    render(<Folha />, sessao(true));
    await screen.findByText("Ana Exemplo");
    expect(screen.getByRole("button", { name: "Recibo da 1ª quinzena de Ana Exemplo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recibo do adiantamento de Bia Exemplo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Recibo .* de Caio Exemplo/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1ª quinzena (1)" }));
    await waitFor(() => expect(imprimirRecibosPagamento).toHaveBeenCalledWith([quinzena]));
    expect(getRecibosPagoAntes).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));

    fireEvent.click(screen.getByRole("button", { name: "Recibo do adiantamento de Bia Exemplo" }));
    await waitFor(() => expect(getRecibosPagoAntes).toHaveBeenLastCalledWith(expect.any(Number), expect.any(Number), "a1"));
  });

  test("sem ver Funcionários: nenhum botão de recibo", async () => {
    vi.mocked(getPayroll).mockResolvedValue(LISTA);
    render(<Folha />, sessao(false));
    await screen.findByText("Ana Exemplo");
    expect(screen.queryByRole("button", { name: /^Recibo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /1ª quinzena \(\d\)/ })).toBeNull();
    expect(screen.queryByText("Recibos (sem registro):")).toBeNull();
  });
});
