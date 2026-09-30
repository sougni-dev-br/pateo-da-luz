import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { TipComputation } from "../../../api/client";
import { ResumoApuracao } from "../ResumoApuracao";

// O resumo explica a conta do ponto nos dois modos da parte de quem saiu.
function comp(paraLivre: boolean): TipComputation {
  return {
    grossPool: 1250, servicoFaturamento: 1250, ajusteServico: 0, deductionPercent: 20, netPool: 1000, fixedTotal: 0,
    rescisoes: { valor: 40, pontos: 10 },
    pontosDisponiveis: paraLivre ? 100 : 90,
    pointsBudget: 100, totalPoints: 90, pointsRemaining: 10,
    pointValue: paraLivre ? 10 : 10.67,
    sobraRescisaoParaSaldo: paraLivre,
    distribuido: paraLivre ? 840 : 1000, saldo: paraLivre ? 160 : 0,
    fundoReservaSaldo: 0, status: "OPEN",
    composicao: {
      mes: { valor: paraLivre ? 800 : 960, pontos: 80, pessoas: 4 },
      rescisoes: { valor: 40, pontos: 10, pessoas: 1, pendentes: 0 },
      reserva: { valor: 0, pontos: 0 },
      fixos: { valor: 0, pessoas: 0 },
    },
  } as unknown as TipComputation;
}

describe("resumo da apuração: parte de quem saiu", () => {
  test("fica com quem continua: rescisões saem antes e o divisor desconta os pontos delas", () => {
    render(<ResumoApuracao comp={comp(false)} />);
    expect(screen.getByText("Rescisões (saem antes)")).toBeTruthy();
    expect(screen.getByText("Pontos que sobram")).toBeTruthy();
    expect(screen.getByText("100 − 10 das rescisões")).toBeTruthy();
    expect(screen.queryByText(/vai para o livre/)).toBeNull();
  });

  test("vai para o livre: rescisões pagas à parte, divisor é o total e o livre explica a sobra", () => {
    render(<ResumoApuracao comp={comp(true)} />);
    expect(screen.getByText("Rescisões (pagas à parte)")).toBeTruthy();
    expect(screen.getByText("Pontos de referência")).toBeTruthy();
    expect(screen.getByText("as rescisões não saem do total")).toBeTruthy();
    // Livre em pontos pelo valor do ponto: R$ 160 ÷ R$ 10 = 16 pts (não os 10 de referência − usados).
    expect(screen.getByText(/Livre para distribuir: 16 pts/)).toBeTruthy();
    expect(screen.getAllByText(/a sobra de quem saiu/).length).toBeGreaterThan(0);
  });

  test("compacto: a dica da linha Rescisões diz para onde vai a sobra em cada modo", () => {
    const { unmount } = render(<ResumoApuracao comp={comp(true)} compacto />);
    expect(screen.getByText("Rescisões (à parte)").closest("span[title]")?.getAttribute("title")).toMatch(/vai para o livre/);
    expect(screen.getByText("Ponto (÷ 100)")).toBeTruthy();
    unmount();
    render(<ResumoApuracao comp={comp(false)} compacto />);
    expect(screen.getByText("Rescisões").closest("span[title]")?.getAttribute("title")).toMatch(/fica com quem continua/);
    expect(screen.getByText("Ponto (÷ 90)")).toBeTruthy();
  });
});
