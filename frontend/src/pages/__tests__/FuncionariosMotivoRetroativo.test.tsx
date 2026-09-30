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
import { dataLocalIso } from "../../lib/datas";
import { Funcionarios } from "../Funcionarios";

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

// Dados fictícios.
const ANA = {
  id: "e1", firstName: "Ana", lastName: "Ficticia", displayName: null, cpf: "00000000000", rg: null, pis: null, birthDate: null,
  gender: "FEMININO", phone: null, email: null, zipCode: null, address: null, addressNumber: null, addressComplement: null,
  neighborhood: null, city: null, state: null, bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null,
  bankAccountType: "CORRENTE", pixKeyType: null, pixKey: null, sector: "Salão", subgroup: null, position: "Garçom",
  baseSalary: "2200.00", salarioCombinado: null, salarioCombinadoMotivo: null, recebeAdiantamento: false, shiftStart: null, shiftEnd: null,
  modality: "NAO_CLT", scheduleRegime: "SEIS_POR_UM", includeInSchedule: true, admissionDate: "2020-01-01T00:00:00.000Z",
  vtType: "NENHUM", vtPeriodicity: "MENSAL", vtFixedAmount: null, vtMonthlyFareId: null, vtLegs: [], terminationDate: null,
  terminationReason: null, isActive: true, notes: null, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
} as unknown as Employee;

// Um dia do mês passado, calculado a partir de hoje (a regra compara o mês da data com o mês atual).
function diaDoMesPassado(): string {
  const d = new Date();
  return dataLocalIso(new Date(d.getFullYear(), d.getMonth() - 1, 10));
}

async function abrirFichaDaAna() {
  render(
    <MemoryRouter>
      <SessionContext.Provider value={SESSAO}><HideValuesProvider><Funcionarios /></HideValuesProvider></SessionContext.Provider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
  fireEvent.change(screen.getByLabelText("Salário base"), { target: { value: "250000" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEmployees).mockResolvedValue([ANA]);
  vi.mocked(getEmployeeOptions).mockResolvedValue({ sectors: [], positions: [] });
  vi.mocked(getEmployeeBirthdays).mockResolvedValue([]);
  vi.mocked(getVtFares).mockResolvedValue([]);
  vi.mocked(getEmployeeHistorico).mockResolvedValue([]);
  vi.mocked(saveEmployee).mockResolvedValue(ANA);
});

describe("ficha: motivo obrigatório quando a alteração é retroativa", () => {
  test("data de hoje: motivo continua opcional", async () => {
    await abrirFichaDaAna();
    expect(screen.getByLabelText("Motivo da alteração")).toBeInTheDocument();
    expect(screen.getByText("Motivo (opcional)")).toBeInTheDocument();
  });

  test("data do mês passado + salário mudou: rótulo muda, bloqueia sem motivo e envia com motivo", async () => {
    await abrirFichaDaAna();
    fireEvent.change(screen.getByLabelText("Vale a partir de"), { target: { value: diaDoMesPassado() } });
    expect(screen.getByText(/Motivo \(obrigatório para data retroativa\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe o motivo: a data é de um mês anterior.")).toBeInTheDocument();
    expect(saveEmployee).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Motivo da alteração"), { target: { value: "Aumento combinado em agosto" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saveEmployee).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveEmployee).mock.calls[0][0]).toMatchObject({ vigenteDesde: diaDoMesPassado(), motivoAlteracao: "Aumento combinado em agosto" });
  });
});
