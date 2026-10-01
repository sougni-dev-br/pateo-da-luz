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

// "Entra na gorjeta em" (regra do Eli, 01/10/2026): quem é contratado começa em teste; o
// dono decide quando entra no cálculo da gorjeta. Vazio = em teste ou fora da gorjeta.
const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

// Dados fictícios.
const BIA = {
  id: "e1", firstName: "Bia", lastName: "Ficticia", displayName: null, cpf: "00000000000", rg: null, pis: null, birthDate: null,
  gender: "FEMININO", phone: null, email: null, zipCode: null, address: null, addressNumber: null, addressComplement: null,
  neighborhood: null, city: null, state: null, bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null,
  bankAccountType: "CORRENTE", pixKeyType: null, pixKey: null, sector: "Salão", subgroup: null, position: "Garçom",
  baseSalary: "2200.00", salarioCombinado: null, salarioCombinadoMotivo: null, recebeAdiantamento: false, shiftStart: null, shiftEnd: null,
  modality: "NAO_CLT", scheduleRegime: "SEIS_POR_UM", includeInSchedule: true, admissionDate: "2026-09-15T00:00:00.000Z",
  inicioGorjeta: null, vtType: "NENHUM", vtPeriodicity: "MENSAL", vtFixedAmount: null, vtMonthlyFareId: null, vtLegs: [], terminationDate: null,
  terminationReason: null, isActive: true, notes: null, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z",
} as unknown as Employee;

function abrirTela() {
  render(
    <MemoryRouter>
      <SessionContext.Provider value={SESSAO}><HideValuesProvider><Funcionarios /></HideValuesProvider></SessionContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEmployees).mockResolvedValue([BIA]);
  vi.mocked(getEmployeeOptions).mockResolvedValue({ sectors: [], positions: [] });
  vi.mocked(getEmployeeBirthdays).mockResolvedValue([]);
  vi.mocked(getVtFares).mockResolvedValue([]);
  vi.mocked(getEmployeeHistorico).mockResolvedValue([]);
  vi.mocked(saveEmployee).mockResolvedValue(BIA);
});

describe("ficha: Entra na gorjeta em", () => {
  test("campo de data com o texto de ajuda, vazio para quem está em teste", async () => {
    abrirTela();
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const campo = screen.getByLabelText("Entra na gorjeta em") as HTMLInputElement;
    expect(campo.type).toBe("date");
    expect(campo.value).toBe("");
    expect(screen.getByText("Vazio = em teste ou fora da gorjeta. Os dias de teste do sem registro são pagos como salário.")).toBeInTheDocument();
  });

  test("preencher envia a data; o histórico pede \"vale a partir de\"", async () => {
    abrirTela();
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const hoje = new Date();
    const futuro = `${hoje.getFullYear() + 1}-01-05`;
    fireEvent.change(screen.getByLabelText("Entra na gorjeta em"), { target: { value: futuro } });
    expect(screen.getByLabelText("Vale a partir de")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saveEmployee).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveEmployee).mock.calls[0][0]).toMatchObject({ inicioGorjeta: futuro });
  });

  test("ficha carrega a data gravada", async () => {
    vi.mocked(getEmployees).mockResolvedValue([{ ...BIA, inicioGorjeta: "2026-09-20T00:00:00.000Z" } as Employee]);
    abrirTela();
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Entra na gorjeta em") as HTMLInputElement).value).toBe("2026-09-20");
  });
});
