import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, Employee } from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getEmployees: vi.fn(),
  getEmployeeOptions: vi.fn(),
  getEmployeeBirthdays: vi.fn(),
  getVtFares: vi.fn(),
  getEmployeeHistorico: vi.fn(),
  saveEmployee: vi.fn(),
}));

import { getEmployeeBirthdays, getEmployeeHistorico, getEmployeeOptions, getEmployees, getVtFares, saveEmployee } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { Funcionarios } from "../Funcionarios";

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

// Dados fictícios: sem registro, R$ 2.000, hoje recebe adiantamento.
const RAFA = {
  id: "e1", firstName: "Rafa", lastName: "Ficticio", displayName: null, cpf: "00000000000", rg: null, pis: null, birthDate: null,
  gender: "MASCULINO", phone: null, email: null, zipCode: null, address: null, addressNumber: null, addressComplement: null,
  neighborhood: null, city: null, state: null, bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null,
  bankAccountType: "CORRENTE", pixKeyType: null, pixKey: null, sector: "Salão", subgroup: null, position: "Garçom",
  baseSalary: "2000.00", salarioCombinado: null, salarioCombinadoMotivo: null, recebeAdiantamento: true, pagamentoQuinzenal: false,
  shiftStart: null, shiftEnd: null,
  modality: "NAO_CLT", scheduleRegime: "SEIS_POR_UM", includeInSchedule: true, admissionDate: "2020-01-01T00:00:00.000Z",
  vtType: "NENHUM", vtPeriodicity: "MENSAL", vtFixedAmount: null, vtMonthlyFareId: null, vtLegs: [], terminationDate: null,
  terminationReason: null, isActive: true, notes: null, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
} as unknown as Employee;

async function abrirFicha(emp: Employee) {
  vi.mocked(getEmployees).mockResolvedValue([emp]);
  render(
    <MemoryRouter>
      <SessionContext.Provider value={SESSAO}><HideValuesProvider><Funcionarios /></HideValuesProvider></SessionContext.Provider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEmployeeOptions).mockResolvedValue({ sectors: [], positions: [] });
  vi.mocked(getEmployeeBirthdays).mockResolvedValue([]);
  vi.mocked(getVtFares).mockResolvedValue([]);
  vi.mocked(getEmployeeHistorico).mockResolvedValue([]);
  vi.mocked(saveEmployee).mockResolvedValue(RAFA);
});

describe("ficha: forma de pagamento do sem registro", () => {
  test("três opções; escolher a quinzena grava a quinzena e desmarca o adiantamento", async () => {
    await abrirFicha(RAFA);
    const select = screen.getByLabelText("Forma de pagamento") as HTMLSelectElement;
    expect(select.value).toBe("ADIANTAMENTO");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Recebe só no pagamento (até o 5º dia útil)", "Recebe adiantamento no dia 20", "Recebe por quinzena (dias 15 e 30)",
    ]);
    fireEvent.change(select, { target: { value: "QUINZENA" } });
    expect(screen.getByText(/metade do salário base no dia 15/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saveEmployee).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveEmployee).mock.calls[0][0]).toMatchObject({ pagamentoQuinzenal: true, recebeAdiantamento: false });
  });

  test("CLT: só o adiantamento informativo, sem a opção de quinzena", async () => {
    await abrirFicha({ ...RAFA, modality: "CLT", recebeAdiantamento: false } as Employee);
    expect(screen.queryByLabelText("Forma de pagamento")).toBeNull();
    expect(screen.getByLabelText("Adiantamento salarial")).toBeInTheDocument();
    expect(screen.getByText(/o adiantamento de quem é registrado vem do extrato/)).toBeInTheDocument();
  });
});
