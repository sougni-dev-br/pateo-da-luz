import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation } from "../../../api/client";

vi.mock("../gorjetaUtils", async (importOriginal) => ({ ...(await importOriginal<typeof import("../gorjetaUtils")>()), baixarCsv: vi.fn() }));
vi.mock("../pdfConferencia", () => ({ gerarPdfConferencia: vi.fn() }));

import { BotoesConferencia } from "../BotoesConferencia";
import { baixarCsv } from "../gorjetaUtils";
import { gerarPdfConferencia } from "../pdfConferencia";

const COMP = {
  year: 2026, month: 11, label: "Gorjeta", code: "GOR-1", status: "OPEN", fechamento: null,
  periodStart: "2026-10-26T00:00:00.000Z", periodEnd: "2026-11-25T00:00:00.000Z",
  grossPool: 1000, servicoFaturamento: 1000, ajusteServico: 0, deductionPercent: 20, netPool: 800, fixedTotal: 0,
  pontosDisponiveis: 10, totalPoints: 10, pointValue: 80, distribuido: 800, saldo: 0, reservaTotal: 0, rescisoes: { valor: 0, pontos: 0 },
  totals: { rateio: 800, vales: 0, netCommission: 800 }, participants: [], pendencias: [], warnings: [], anterior: null,
} as unknown as TipComputation;

const obterCalculo = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  obterCalculo.mockResolvedValue(COMP);
});

describe("BotoesConferencia", () => {
  test("a planilha baixa o CSV da competência, com o cálculo atual", async () => {
    render(<BotoesConferencia obterCalculo={obterCalculo} onErro={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Conferência planilha/ }));
    await waitFor(() => expect(baixarCsv).toHaveBeenCalledTimes(1));
    expect(obterCalculo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(baixarCsv).mock.calls[0][0]).toBe("Gorjeta_Conferencia_Novembro_2026.csv");
  });

  test("o PDF é gerado só no clique, com o cálculo que obterCalculo devolveu", async () => {
    const recalculado = { ...COMP, netPool: 900 } as TipComputation;
    obterCalculo.mockResolvedValue(recalculado);
    render(<BotoesConferencia obterCalculo={obterCalculo} onErro={vi.fn()} />);
    expect(gerarPdfConferencia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Conferência PDF/ }));
    await waitFor(() => expect(gerarPdfConferencia).toHaveBeenCalledWith(recalculado));
  });

  test("falha ao gerar o PDF avisa, em português, e o botão volta", async () => {
    vi.mocked(gerarPdfConferencia).mockRejectedValue(new Error("sem memória"));
    const onErro = vi.fn();
    render(<BotoesConferencia obterCalculo={obterCalculo} onErro={onErro} />);
    fireEvent.click(screen.getByRole("button", { name: /Conferência PDF/ }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith("Erro ao gerar o PDF de conferência: sem memória"));
    expect(screen.getByRole("button", { name: /Conferência PDF/ })).toBeEnabled();
  });

  test("erro que não é Error, ou carga de arquivo velho, vira mensagem útil", async () => {
    vi.mocked(gerarPdfConferencia).mockRejectedValueOnce("falhou");
    const onErro = vi.fn();
    render(<BotoesConferencia obterCalculo={obterCalculo} onErro={onErro} />);
    fireEvent.click(screen.getByRole("button", { name: /Conferência PDF/ }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith("Erro ao gerar o PDF de conferência: tente novamente"));
    obterCalculo.mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module: x.js"));
    fireEvent.click(screen.getByRole("button", { name: /Conferência PDF/ }));
    await waitFor(() => expect(onErro).toHaveBeenLastCalledWith(expect.stringContaining("recarregue (Ctrl+F5)")));
  });

  test("falha ao montar a planilha também avisa", async () => {
    vi.mocked(baixarCsv).mockImplementation(() => { throw new Error("bloqueado"); });
    const onErro = vi.fn();
    render(<BotoesConferencia obterCalculo={obterCalculo} onErro={onErro} />);
    fireEvent.click(screen.getByRole("button", { name: /Conferência planilha/ }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith("Erro ao gerar a planilha de conferência: bloqueado"));
  });
});
