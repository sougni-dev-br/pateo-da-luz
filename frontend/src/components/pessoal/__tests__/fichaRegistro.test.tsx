import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Employee, EmployeeFicha } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getEmployeeFicha: vi.fn(),
}));

import { getEmployeeFicha } from "../../../api/client";
import { DocumentosRegistro, resumoDocumentos } from "../DocumentosRegistro";
import { FichaRegistro } from "../FichaRegistro";
import { fichaFormDe, fichaFormVazio, fichaParaSalvar } from "../fichaRegistroForm";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

// Pessoa fictícia.
const FICHA: EmployeeFicha = {
  dependentes: [{ id: "d1", nome: "CICLANO DE TAL", parentesco: null, dataNascimento: null }],
  ferias: [
    { aquisitivoInicio: "2024-03-01", aquisitivoFim: "2025-02-28", concessivoFim: "2026-02-28", diasGozados: 20, diasAbono: 10, status: "QUITADO",
      gozos: [{ inicio: "2025-07-01", fim: "2025-07-20", abonoInicio: "2025-07-21", abonoFim: "2025-07-30" }] },
    { aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", concessivoFim: "2027-02-28", diasGozados: 0, diasAbono: 0, status: "A_GOZAR", gozos: [] },
  ],
  salarioOculto: false,
  carteira: [
    { id: "c2", tipo: "CARGO", data: "2026-05-01", salario: null, retroativoCompetencia: null, cargoAnterior: "COZINHEIRO (A)", cboAnterior: "513205", cargo: "LIDER DE PRACA", cbo: "513210" },
    { id: "c1", tipo: "SALARIO", data: "2026-04-01", salario: 2100, retroativoCompetencia: "02/2026", cargoAnterior: null, cboAnterior: null, cargo: null, cbo: null },
  ],
};

describe("seção Ficha de registro", () => {
  beforeEach(() => vi.mocked(getEmployeeFicha).mockReset());

  test("mostra dependentes, férias com situação e prazo, e a carteira com salário e cargo", async () => {
    vi.mocked(getEmployeeFicha).mockResolvedValue(FICHA);
    render(<FichaRegistro employeeId="e1" />);
    await waitFor(() => expect(screen.getByText("CICLANO DE TAL")).toBeTruthy());
    expect(screen.getByText("Gozadas")).toBeTruthy();
    expect(screen.getByText("A gozar")).toBeTruthy();
    expect(screen.getByText(/prazo para conceder até 28\/02\/2027/)).toBeTruthy();
    expect(screen.getByText(/abono 21\/07\/2025 a 30\/07\/2025/)).toBeTruthy();
    expect(screen.getByText(/COZINHEIRO \(A\) → LIDER DE PRACA/)).toBeTruthy();
    expect(screen.getByText(/2\.100,00/)).toBeTruthy();
    expect(screen.getByText("retroativo à competência 02/2026")).toBeTruthy();
  });

  test("salário oculto: a carteira não mostra valor", async () => {
    vi.mocked(getEmployeeFicha).mockResolvedValue({ ...FICHA, salarioOculto: true, carteira: FICHA.carteira.map((a) => ({ ...a, salario: null })) });
    render(<FichaRegistro employeeId="e1" />);
    await waitFor(() => expect(screen.getByText("salário oculto")).toBeTruthy());
    expect(screen.queryByText(/2\.100/)).toBeNull();
  });

  test("ficha não importada: avisa em vez de listas vazias", async () => {
    vi.mocked(getEmployeeFicha).mockResolvedValue({ dependentes: [], ferias: [{ ...FICHA.ferias[1] }], salarioOculto: false, carteira: [] });
    render(<FichaRegistro employeeId="e1" />);
    await waitFor(() => expect(screen.getByText(/ainda não importada/)).toBeTruthy());
  });
});

describe("seção Documentos e contrato em carteira", () => {
  test("abre recolhida com o resumo; 'Ver e editar' mostra os campos e editar devolve o formulário novo", () => {
    const onChange = vi.fn();
    const valor = { ...fichaFormVazio, ctpsNumero: "5299822", ctpsSerie: "4725", ctpsUf: "SP", cbo: "513210", jornadaInicio: "08:00", jornadaFim: "16:20" };
    render(<DocumentosRegistro value={valor} onChange={onChange} />);
    expect(screen.getByText("CTPS 5299822 série 4725 SP · CBO 513210 · jornada 08:00–16:20")).toBeTruthy();
    expect(screen.queryByLabelText("Nome da mãe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ver e editar" }));
    fireEvent.change(screen.getByLabelText("Nome da mãe"), { target: { value: "M" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, nomeMae: "M" });
    expect(screen.getByRole("button", { name: "Recolher" }).getAttribute("aria-expanded")).toBe("true");
  });

  test("nada preenchido: o resumo diz isso", () => {
    expect(resumoDocumentos(fichaFormVazio)).toBe("Nada preenchido ainda.");
  });
});

describe("campos da ficha no formulário", () => {
  test("do cadastro para o formulário: datas sem hora, deficiência sim/não", () => {
    const e = { nomeMae: "MARIA DE TAL", rgDataEmissao: "2016-01-15T00:00:00.000Z", possuiDeficiencia: false, ctpsUf: null } as unknown as Employee;
    expect(fichaFormDe(e)).toMatchObject({ nomeMae: "MARIA DE TAL", rgDataEmissao: "2016-01-15", possuiDeficiencia: "nao", ctpsUf: "" });
  });

  test("salvar manda só o que mudou desde que a ficha foi aberta; apagar um campo manda null", () => {
    const original = fichaFormDe({ nomeMae: "MARIA DE TAL", nomePai: "JOSE DE TAL", possuiDeficiencia: false } as unknown as Employee);
    expect(fichaParaSalvar(original, original)).toEqual({});
    expect(fichaParaSalvar({ ...original, nomePai: "  ", cbo: "513205 ", possuiDeficiencia: "" }, original)).toEqual({
      nomePai: null, cbo: "513205", possuiDeficiencia: null,
    });
  });

  test("nome completo vai e volta como os outros campos da ficha", () => {
    const original = fichaFormDe({ nomeCompleto: "ANA SILVA DE TAL" } as unknown as Employee);
    expect(original.nomeCompleto).toBe("ANA SILVA DE TAL");
    expect(fichaParaSalvar({ ...original, nomeCompleto: "ANA SILVA DE TAL SOUZA" }, original)).toEqual({ nomeCompleto: "ANA SILVA DE TAL SOUZA" });
  });

  test("ficha aberta ANTES da importação e salva depois não manda os campos importados (não os apaga)", () => {
    const abertaVazia = fichaFormVazio;
    const enviado = fichaParaSalvar({ ...abertaVazia, estadoCivil: "Casado" }, abertaVazia);
    expect(enviado).toEqual({ estadoCivil: "Casado" });
    expect(enviado).not.toHaveProperty("ctpsNumero");
  });
});
