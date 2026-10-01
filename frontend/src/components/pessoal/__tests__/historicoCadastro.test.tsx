import { act, render as renderRaw, screen, waitFor } from "@testing-library/react";
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
import { ehDinheiro, motivoObrigatorio, mudouCampoComHistorico, textoDoValor, type CamposComHistorico } from "../historicoCadastroFormato";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const envolver = (ui: ReactElement) => <SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>;
const render = (ui: ReactElement) => renderRaw(envolver(ui));

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

  test("trocar de ficha: o histórico da pessoa anterior some na hora e a resposta atrasada dela é ignorada", async () => {
    let soltarA: (l: EmployeeHistoricoLinha[]) => void = () => undefined;
    let soltarB: (l: EmployeeHistoricoLinha[]) => void = () => undefined;
    vi.mocked(getEmployeeHistorico).mockResolvedValueOnce([linha({ id: "a0", motivo: "Motivo da Ana" })]);
    const { rerender } = render(<HistoricoCadastro employeeId="ana" />);
    await waitFor(() => expect(screen.getByText("Motivo da Ana")).toBeTruthy());

    // Vai para Bia (fetch pendente): a Ana não pode continuar na tela.
    vi.mocked(getEmployeeHistorico).mockImplementationOnce(() => new Promise((r) => { soltarB = r; }));
    rerender(envolver(<HistoricoCadastro employeeId="bia" />));
    expect(screen.queryByText("Motivo da Ana")).toBeNull();
    expect(screen.getByText("Carregando…")).toBeTruthy();

    // Volta para a Ana e de novo para a Bia; as respostas chegam fora de ordem.
    vi.mocked(getEmployeeHistorico).mockImplementationOnce(() => new Promise((r) => { soltarA = r; }));
    rerender(envolver(<HistoricoCadastro employeeId="ana" />));
    vi.mocked(getEmployeeHistorico).mockResolvedValueOnce([linha({ id: "b1", motivo: "Motivo da Bia" })]);
    rerender(envolver(<HistoricoCadastro employeeId="bia" />));
    await waitFor(() => expect(screen.getByText("Motivo da Bia")).toBeTruthy());
    await act(async () => { soltarA([linha({ id: "a1", motivo: "Motivo da Ana atrasado" })]); soltarB([]); });
    expect(screen.queryByText("Motivo da Ana atrasado")).toBeNull();
    expect(screen.queryByText(/Nenhuma alteração/)).toBeNull();
    expect(screen.getByText("Motivo da Bia")).toBeTruthy();
  });

  test("trocar de ficha depois de um erro: o erro da anterior não fica", async () => {
    vi.mocked(getEmployeeHistorico).mockRejectedValueOnce(new Error("falhou a Ana"));
    const { rerender } = render(<HistoricoCadastro employeeId="ana" />);
    await waitFor(() => expect(screen.getByText("falhou a Ana")).toBeTruthy());
    vi.mocked(getEmployeeHistorico).mockImplementationOnce(() => new Promise(() => undefined));
    rerender(envolver(<HistoricoCadastro employeeId="bia" />));
    expect(screen.queryByText("falhou a Ana")).toBeNull();
    expect(screen.getByText("Carregando…")).toBeTruthy();
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

describe("motivo obrigatório para data retroativa (antecipa o 400 do backend)", () => {
  const original: CamposComHistorico = { baseSalary: "2.200,00", salarioCombinado: "", modality: "CLT", position: "Garçom", recebeAdiantamento: false };
  const HOJE = "2026-09-30";

  test("mês anterior + salário, combinado ou vínculo: obrigatório", () => {
    expect(motivoObrigatorio(original, { ...original, baseSalary: "2.500,00" }, "2026-08-15", HOJE)).toBe(true);
    expect(motivoObrigatorio(original, { ...original, salarioCombinado: "3.000,00" }, "2026-01-01", HOJE)).toBe(true);
    expect(motivoObrigatorio(original, { ...original, modality: "NAO_CLT" }, "2025-12-31", HOJE)).toBe(true);
  });

  test("mesmo mês ou futuro: opcional", () => {
    expect(motivoObrigatorio(original, { ...original, baseSalary: "2.500,00" }, "2026-09-01", HOJE)).toBe(false);
    expect(motivoObrigatorio(original, { ...original, baseSalary: "2.500,00" }, "2026-10-01", HOJE)).toBe(false);
  });

  test("retroativo, mas só cargo ou adiantamento mudou: opcional", () => {
    expect(motivoObrigatorio(original, { ...original, position: "Líder" }, "2026-08-01", HOJE)).toBe(false);
    expect(motivoObrigatorio(original, { ...original, recebeAdiantamento: true }, "2026-08-01", HOJE)).toBe(false);
  });

  test("combinado de quem não é CLT não conta (não vai ao backend); data vazia ou cadastro novo: opcional", () => {
    const naoClt = { ...original, modality: "NAO_CLT" as const };
    expect(motivoObrigatorio(naoClt, { ...naoClt, salarioCombinado: "3.000,00" }, "2026-08-01", HOJE)).toBe(false);
    expect(motivoObrigatorio(original, { ...original, baseSalary: "2.500,00" }, "", HOJE)).toBe(false);
    expect(motivoObrigatorio(null, original, "2026-08-01", HOJE)).toBe(false);
  });
});

describe("teto do IR para a gorjeta informada na ficha", () => {
  const original: CamposComHistorico = { baseSalary: "3.672,00", salarioCombinado: "5.200,00", tetoIrGorjeta: "", modality: "CLT", position: "Gerente", recebeAdiantamento: true };
  test("pôr o teto pede \"vale a partir de\"; retroativo exige motivo", () => {
    expect(mudouCampoComHistorico(original, { ...original, tetoIrGorjeta: "5.000,00" })).toBe(true);
    expect(motivoObrigatorio(original, { ...original, tetoIrGorjeta: "5.000,00" }, "2026-09-01", "2026-10-01")).toBe(true);
    expect(motivoObrigatorio(original, { ...original, tetoIrGorjeta: "5.000,00" }, "2026-10-01", "2026-10-01")).toBe(false);
  });
  test("sem registro: o teto não vai ao backend, não conta como mudança", () => {
    const sr = { ...original, modality: "NAO_CLT" as const };
    expect(mudouCampoComHistorico(sr, { ...sr, tetoIrGorjeta: "5.000,00" })).toBe(false);
  });
  test("é dinheiro no histórico", () => {
    expect(ehDinheiro({ campo: "tetoIrGorjeta" })).toBe(true);
  });
});

describe("entrada na gorjeta na ficha", () => {
  const original: CamposComHistorico = { baseSalary: "2.200,00", salarioCombinado: "", modality: "NAO_CLT", position: "Garçom", recebeAdiantamento: false, inicioGorjeta: "" };
  const HOJE = "2026-10-01";

  test("pôr, trocar ou tirar a data pede \"vale a partir de\"", () => {
    expect(mudouCampoComHistorico(original, { ...original, inicioGorjeta: "2026-10-05" })).toBe(true);
    expect(mudouCampoComHistorico({ ...original, inicioGorjeta: "2026-10-05" }, original)).toBe(true);
    expect(mudouCampoComHistorico(original, { ...original })).toBe(false);
  });

  test("a própria data num mês passado exige motivo (mesmo com \"vale a partir de\" hoje)", () => {
    expect(motivoObrigatorio(original, { ...original, inicioGorjeta: "2026-09-10" }, HOJE, HOJE)).toBe(true);
    expect(motivoObrigatorio({ ...original, inicioGorjeta: "2026-08-01" }, original, HOJE, HOJE)).toBe(true);
    expect(motivoObrigatorio(original, { ...original, inicioGorjeta: "2026-10-05" }, HOJE, HOJE)).toBe(false);
  });

  test("no histórico aparece como dia (dd/mm/aaaa) ou \"vazio\"", () => {
    expect(textoDoValor("inicioGorjeta", "2026-09-10")).toBe("10/09/2026");
    expect(textoDoValor("inicioGorjeta", null)).toBe("vazio");
  });
});
