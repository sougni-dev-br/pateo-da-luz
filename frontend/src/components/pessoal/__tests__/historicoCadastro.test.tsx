import { render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { EmployeeHistoricoLinha } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getEmployeeHistorico: vi.fn(),
}));

import { getEmployeeHistorico } from "../../../api/client";
import { HistoricoCadastro } from "../HistoricoCadastro";
import { mudouCampoComHistorico, type CamposComHistorico } from "../historicoCadastroFormato";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const linha = (over: Partial<EmployeeHistoricoLinha>): EmployeeHistoricoLinha => ({
  id: "h1", campo: "baseSalary", rotulo: "Salário base", valorAnterior: "2000.00", valorNovo: "2200.00", oculto: false,
  vigenteDesde: "2026-08-01", motivo: null, origem: "CADASTRO", criadoPorNome: "Eli", createdAt: "2026-08-01T15:00:00.000Z", ...over,
});

describe("seção Histórico do cadastro", () => {
  beforeEach(() => vi.mocked(getEmployeeHistorico).mockReset());

  test("mostra vigência, de → para, motivo, quem registrou e a origem", async () => {
    vi.mocked(getEmployeeHistorico).mockResolvedValue([
      linha({ id: "h2", campo: "modality", rotulo: "Vínculo", valorAnterior: "NAO_CLT", valorNovo: "CLT", vigenteDesde: "2026-10-01", motivo: "Efetivada", origem: "BACKFILL" }),
      linha({}),
    ]);
    render(<HistoricoCadastro employeeId="e1" />);
    await waitFor(() => expect(screen.getByText("Vínculo")).toBeTruthy());
    expect(screen.getByText(/Sem registro → CLT/)).toBeTruthy();
    expect(screen.getByText("Efetivada")).toBeTruthy();
    expect(screen.getByText("01/10/2026")).toBeTruthy();
    expect(screen.getByText(/Reconstruído da auditoria · Eli em/)).toBeTruthy();
    expect(screen.getByText(/2\.200,00/)).toBeTruthy();
  });

  test("salário sem permissão: aparece \"alterado\", sem valores", async () => {
    vi.mocked(getEmployeeHistorico).mockResolvedValue([linha({ oculto: true, valorAnterior: null, valorNovo: null })]);
    render(<HistoricoCadastro employeeId="e1" />);
    await waitFor(() => expect(screen.getByText("alterado")).toBeTruthy());
    expect(screen.queryByText(/2\.200/)).toBeNull();
  });

  test("sem alterações: explica que o cadastro vale como está", async () => {
    vi.mocked(getEmployeeHistorico).mockResolvedValue([]);
    render(<HistoricoCadastro employeeId="e1" />);
    await waitFor(() => expect(screen.getByText(/Nenhuma alteração/)).toBeTruthy());
  });
});

describe("quando a ficha pede \"vale a partir de\"", () => {
  const original: CamposComHistorico = { baseSalary: "2.200,00", salarioCombinado: "", modality: "CLT", position: "Garçom", recebeAdiantamento: false };

  test("nada mudou (mesmo salário escrito de outro jeito): não pede", () => {
    expect(mudouCampoComHistorico(original, { ...original, baseSalary: "2200" })).toBe(false);
  });
  test("salário, vínculo, cargo, adiantamento ou combinado mudou: pede", () => {
    expect(mudouCampoComHistorico(original, { ...original, baseSalary: "2.500,00" })).toBe(true);
    expect(mudouCampoComHistorico(original, { ...original, modality: "NAO_CLT" })).toBe(true);
    expect(mudouCampoComHistorico(original, { ...original, position: "Líder" })).toBe(true);
    expect(mudouCampoComHistorico(original, { ...original, recebeAdiantamento: true })).toBe(true);
    expect(mudouCampoComHistorico(original, { ...original, salarioCombinado: "5.200,00" })).toBe(true);
  });
  test("cadastro novo não pede (não há o que comparar)", () => {
    expect(mudouCampoComHistorico(null, original)).toBe(false);
  });
});
