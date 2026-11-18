import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PreviaFeriasCombinado } from "../../../../api/client";

vi.mock("../../../../api/client", async (original) => ({ ...(await original<typeof import("../../../../api/client")>()), complementarFeriasCombinado: vi.fn() }));
import { complementarFeriasCombinado } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { ComplementarCombinado } from "../ComplementarCombinado";

const mock = vi.mocked(complementarFeriasCombinado);
const SESSAO = { hideSensitiveValues: false, toggleSensitiveValues: () => undefined } as unknown as SessionContextValue;
const mes = (n: number) => `2026-${String(n).padStart(2, "0")}`;
const previa = (o: Partial<PreviaFeriasCombinado> = {}): PreviaFeriasCombinado => ({
  payrollItemId: "pi1", employeeId: "e1", nome: "Ana Paula Exemplo", combinado: 6000, mediaGorjeta: 1500, mesesContados: 11,
  mesesAusentes: [mes(1)], remuneracao: 10000, liquidoRecibo: 5000, complemento: 5000, valorAntes: 5000, valorDepois: 10000,
  formula: "(6.000,00 + 1.500,00) × 4/3 − 5.000,00",
  meses: [{ chave: mes(1), valor: null, origem: "AUSENTE" }, { chave: mes(2), valor: 1500, origem: "APURACAO" }],
  avisos: ["1 mês(es) sem apuração nem valor informado: não entram na média."], ...o,
});
const abrir = () => {
  const onClose = vi.fn();
  const onAplicou = vi.fn();
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><ComplementarCombinado payrollItemId="pi1" nome="Ana Paula Exemplo" onClose={onClose} onAplicou={onAplicou} /></HideValuesProvider>
    </SessionContext.Provider>,
  );
  return { onClose, onAplicou };
};

beforeEach(() => { mock.mockReset(); });

describe("ComplementarCombinado", () => {
  test("abre calculando só a prévia (aplicar=false) e mostra fórmula, complemento e meses", async () => {
    mock.mockResolvedValue({ aplicado: false, previa: previa() });
    abrir();
    expect(await screen.findByText(/× 4\/3/)).toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1]).toBe(false);
    expect(screen.getByText("Novo valor do título")).toBeInTheDocument();
    expect(screen.getByText(/sem apuração nem valor informado/)).toBeInTheDocument();
    expect(screen.getByText("01/2026")).toBeInTheDocument();
  });

  test("confirmar grava com aplicar=true e avisa a tela ao concluir", async () => {
    mock.mockResolvedValueOnce({ aplicado: false, previa: previa() }).mockResolvedValueOnce({ aplicado: true, previa: previa() });
    const { onClose, onAplicou } = abrir();
    await screen.findByText(/× 4\/3/);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e somar ao título" }));
    expect(await screen.findByText("Complemento gravado no título de férias.")).toBeInTheDocument();
    expect(mock.mock.calls[1][1]).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(onAplicou).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("gorjeta informada à mão vai em gorjetasInformadas ao recalcular", async () => {
    mock.mockResolvedValue({ aplicado: false, previa: previa() });
    abrir();
    fireEvent.change(await screen.findByLabelText("Gorjeta de 01/2026"), { target: { value: "1.234,50" } });
    fireEvent.click(screen.getByRole("button", { name: /Recalcular prévia/ }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(mock.mock.calls[1]).toEqual(["pi1", false, { "2026-01": 1234.5 }]);
  });

  test("mostra a recusa da rota e não deixa confirmar", async () => {
    mock.mockRejectedValue(new Error("O título de férias de Ana já foi pago: não é alterado."));
    abrir();
    expect(await screen.findByText(/já foi pago/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar e somar ao título" })).toHaveAttribute("aria-disabled", "true");
  });

  test("sem complemento a somar, o botão de confirmar fica travado", async () => {
    mock.mockResolvedValue({ aplicado: false, motivo: "Nada a somar.", previa: previa({ complemento: 0, valorDepois: 5000 }) });
    abrir();
    expect(await screen.findByText("Nada a somar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar e somar ao título" })).toHaveAttribute("aria-disabled", "true");
  });
});
