import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonthHeader } from "../../components/MonthHeader";

function setup(overrides: Partial<Parameters<typeof MonthHeader>[0]> = {}) {
  const handlers = { onChange: vi.fn(), onStep: vi.fn(), onToday: vi.fn(), onRefresh: vi.fn() };
  render(
    <MonthHeader eyebrow="Financeiro · Faturamento" competence="2020-03" loading={false} updatedAt={null} {...handlers} {...overrides} />
  );
  return handlers;
}

describe("MonthHeader", () => {
  it("mostra o mês como título e a linha pequena acima", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Março 2020");
    expect(screen.getByText("Financeiro · Faturamento")).toBeTruthy();
  });

  it("mês passado aparece como encerrado e oferece voltar ao mês atual", () => {
    const handlers = setup();
    expect(screen.getByText("Mês encerrado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mês atual" }));
    expect(handlers.onToday).toHaveBeenCalled();
  });

  it("as setas pedem o mês anterior e o próximo", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(handlers.onStep.mock.calls).toEqual([[-1], [1]]);
  });

  it("escolher uma competência válida avisa a tela; lixo é ignorado", () => {
    const handlers = setup();
    const input = screen.getByLabelText("Escolher competência") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2020-07" } });
    expect(handlers.onChange).toHaveBeenCalledWith("2020-07");
    fireEvent.change(input, { target: { value: "2010-01" } });
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
  });

  it("atualizar fica desabilitado enquanto carrega", () => {
    setup({ loading: true });
    expect((screen.getByRole("button", { name: "Atualizar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("intervalo livre troca o título e o status, e mantém a volta ao mês atual", () => {
    setup({ competence: "2026-10", rangeTitle: "01/06/2026 a 30/06/2026", rangeStatus: "Período personalizado" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("01/06/2026 a 30/06/2026");
    expect(screen.getByText("Período personalizado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mês atual" })).toBeTruthy();
  });

  it("mostra a hora da última atualização", () => {
    setup({ updatedAt: new Date(2026, 9, 26, 13, 33) });
    expect(screen.getByText(/atualizado às 13:33/)).toBeTruthy();
  });

  it("renderiza os botões da tela ao lado do seletor", () => {
    setup({ actions: <button type="button">Caixa</button> });
    expect(screen.getByRole("button", { name: "Caixa" })).toBeTruthy();
  });
});
