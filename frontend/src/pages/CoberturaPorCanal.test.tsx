import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CoberturaCanal, CoberturaFaturamento } from "../api/client";

const canal = (parcial: Partial<CoberturaCanal> & Pick<CoberturaCanal, "canal">): CoberturaCanal => ({
  situacao: "EM_DIA",
  ultimoDia: "2026-10-21",
  diasDesdeUltimo: 1,
  diasNoPeriodo: 21,
  diasComDado: 21,
  diasSemLancamento: [],
  origens: [],
  ...parcial,
});

const resposta = (channels: CoberturaCanal[]): CoberturaFaturamento =>
  ({
    period: { year: 2026, month: 10, from: "2026-10-01", to: "2026-10-31" },
    today: "2026-10-22",
    channels,
    agenteKeeta: { estado: "aguardando", alertas: [], horasSemOk: null },
  }) as unknown as CoberturaFaturamento;

const getRevenueCoverage = vi.fn();
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  getRevenueCoverage: (...args: unknown[]) => getRevenueCoverage(...args),
}));

import { CoberturaPorCanal } from "./CoberturaPorCanal";

describe("CoberturaPorCanal", () => {
  test("lançamento com data futura é explicado no cartão do canal", async () => {
    getRevenueCoverage.mockResolvedValue(
      resposta([
        canal({ canal: "iFood", situacao: "SEM_DADOS", ultimoDia: null, diasDesdeUltimo: null, diasComDado: 0, lancamentosFuturos: ["2026-10-31"] }),
      ]),
    );
    render(<CoberturaPorCanal year={2026} month={10} />);
    expect(await screen.findByText(/Lançamento com data futura \(31\/10\)/)).toBeInTheDocument();
    expect(screen.getByText("Sem dados")).toBeInTheDocument();
  });

  test("canal sem lançamento futuro não mostra o aviso", async () => {
    getRevenueCoverage.mockResolvedValue(resposta([canal({ canal: "Salão" })]));
    render(<CoberturaPorCanal year={2026} month={10} />);
    expect(await screen.findByText("Em dia")).toBeInTheDocument();
    expect(screen.queryByText(/data futura/)).toBeNull();
  });
});
