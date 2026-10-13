import { fireEvent, render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", () => ({ getDesperdicioDoCiclo: vi.fn() }));

import { getDesperdicioDoCiclo, type DesperdicioDoCiclo as Dados } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { DesperdicioDoCiclo } from "../DesperdicioDoCiclo";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>);

const dados = (parcial: Partial<Dados>): Dados => ({
  dataInicial: "2026-09-01", dataFinal: "2026-09-30",
  total: { lancamentos: 3, valor: 300, semCusto: 0 },
  porMotivo: [{ chave: "EXPIRED", nome: "Vencido", lancamentos: 2, valor: 200, semCusto: 0 }],
  percentualDoCmv: 3,
  ...parcial,
});

beforeEach(() => vi.clearAllMocks());

describe("DesperdicioDoCiclo", () => {
  test("diz quanto do consumo foi desperdício e que não soma ao CMV", async () => {
    vi.mocked(getDesperdicioDoCiclo).mockResolvedValue(dados({}));
    render(<DesperdicioDoCiclo periodoId="c1" />);

    const bloco = await screen.findByRole("region", { name: /desperdício registrado/i });
    expect(bloco).toHaveTextContent(/R\$\s?300/);
    expect(bloco).toHaveTextContent("3% do CMV");
    expect(bloco).toHaveTextContent("3 lançamentos");
    expect(bloco).toHaveTextContent("principalmente vencido");
    expect(bloco).toHaveTextContent("não é somado a ele");
    // A origem do valor é dita: insumo ao último custo de compra, prato ao custo da ficha.
    expect(bloco).toHaveTextContent("custo da ficha técnica");
    expect(bloco).toHaveTextContent("Reflete os lançamentos de agora");
    expect(getDesperdicioDoCiclo).toHaveBeenCalledWith("c1");
  });

  test("avisa quando parte dos lançamentos está sem custo", async () => {
    vi.mocked(getDesperdicioDoCiclo).mockResolvedValue(dados({ total: { lancamentos: 3, valor: 300, semCusto: 1 } }));
    render(<DesperdicioDoCiclo periodoId="c1" />);
    expect(await screen.findByText(/1 sem custo ficam de fora/)).toBeInTheDocument();
  });

  test("tudo sem custo não mostra 'R$ 0,00 de desperdício': diz que não dá para saber o valor", async () => {
    vi.mocked(getDesperdicioDoCiclo).mockResolvedValue(dados({ total: { lancamentos: 2, valor: 0, semCusto: 2 }, porMotivo: [], percentualDoCmv: null }));
    render(<DesperdicioDoCiclo periodoId="c1" />);
    const bloco = await screen.findByRole("region", { name: /desperdício registrado/i });
    expect(bloco).toHaveTextContent("2 lançamentos de desperdício neste ciclo, todos sem custo conhecido");
    expect(bloco).not.toHaveTextContent(/R\$\s?0,00/);
  });

  test("ciclo sem desperdício oferece o registro", async () => {
    vi.mocked(getDesperdicioDoCiclo).mockResolvedValue(dados({ total: { lancamentos: 0, valor: 0, semCusto: 0 }, porMotivo: [], percentualDoCmv: null }));
    render(<DesperdicioDoCiclo periodoId="c1" />);
    expect(await screen.findByText(/Nenhum desperdício registrado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar" })).toHaveAttribute("href", "/estoque/desperdicio");
  });

  test("se a consulta falha, diz que não carregou (não parece 'sem desperdício') e deixa tentar de novo", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getDesperdicioDoCiclo).mockRejectedValueOnce(new Error("fora do ar")).mockResolvedValue(dados({}));
    render(<DesperdicioDoCiclo periodoId="c1" />);

    expect(await screen.findByText(/Não foi possível carregar o desperdício deste ciclo/)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum desperdício registrado/)).not.toBeInTheDocument();
    expect(erro).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("region", { name: /desperdício registrado/i })).toBeInTheDocument();
    erro.mockRestore();
  });
});
