import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PreviaFeriasCombinado } from "../../../../api/client";

vi.mock("../../../../api/client", async (original) => ({ ...(await original<typeof import("../../../../api/client")>()), complementarFeriasCombinado: vi.fn() }));
import { complementarFeriasCombinado } from "../../../../api/client";
vi.mock("../pdfComplementoFerias", () => ({ gerarPdfComplementoFerias: vi.fn(async () => undefined) }));
import { gerarPdfComplementoFerias } from "../pdfComplementoFerias";
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

  test("depois de digitar um valor, só deixa confirmar quando a prévia for recalculada", async () => {
    mock.mockResolvedValue({ aplicado: false, previa: previa() });
    abrir();
    const confirmar = await screen.findByRole("button", { name: "Confirmar e somar ao título" });
    expect(confirmar).toHaveAttribute("aria-disabled", "false");
    fireEvent.change(await screen.findByLabelText("Gorjeta de 01/2026"), { target: { value: "900" } });
    expect(screen.getByText(/recalcule a prévia para ver o novo complemento/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar e somar ao título" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: /Recalcular prévia/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e somar ao título" })).toHaveAttribute("aria-disabled", "false"));
    expect(screen.queryByText(/recalcule a prévia para ver o novo complemento/)).not.toBeInTheDocument();
  });

  test("gorjeta informada à mão vai em gorjetasInformadas ao recalcular", async () => {
    mock.mockResolvedValue({ aplicado: false, previa: previa() });
    abrir();
    fireEvent.change(await screen.findByLabelText("Gorjeta de 01/2026"), { target: { value: "1.234,50" } });
    fireEvent.click(screen.getByRole("button", { name: /Recalcular prévia/ }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(mock.mock.calls[1]).toEqual(["pi1", false, { "2026-01": 1234.5 }]);
  });

  test("qualquer mês é digitável, mostra a apuração do ERP como referência e o selo quando o informado vale", async () => {
    mock.mockResolvedValue({
      aplicado: false,
      previa: previa({ meses: [
        { chave: mes(2), valor: 1500, origem: "APURACAO", apuracaoErp: 1500 }, { chave: mes(3), valor: 0, origem: "APURACAO", apuracaoErp: 0 },
        { chave: mes(4), valor: 2593.97, origem: "INFORMADA", apuracaoErp: 2016.17 }, { chave: mes(5), valor: 800, origem: "INFORMADA", apuracaoErp: null },
      ] }),
    });
    abrir();
    expect(await screen.findByLabelText("Gorjeta de 02/2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Gorjeta de 03/2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Gorjeta de 04/2026")).toHaveValue("2593.97");
    expect(Array.from(document.querySelectorAll(".fe-comb-mes-ref")).map((e) => e.textContent ?? "").some((t) => /ERP:.*2\.016,17/.test(t))).toBe(true);
    expect(screen.getAllByText("informado vale sobre a apuração")).toHaveLength(1);
    expect(screen.getByText("informada à mão")).toBeInTheDocument();
    expect(screen.getAllByText("apuração")).toHaveLength(2);
    expect(screen.getByText(/o valor informado vale sobre a apuração do ERP/)).toBeInTheDocument();
  });

  test("mês antes de setembro sem informado pede para informar à mão e mostra a apuração do ERP só como referência", async () => {
    mock.mockResolvedValue({
      aplicado: false,
      previa: previa({ meses: [
        { chave: mes(7), valor: null, origem: "AUSENTE", apuracaoErp: 0 }, { chave: mes(8), valor: null, origem: "AUSENTE", apuracaoErp: 2016.17 },
        { chave: mes(1), valor: null, origem: "AUSENTE", apuracaoErp: null },
      ] }),
    });
    abrir();
    expect(await screen.findByLabelText("Gorjeta de 08/2026")).toBeInTheDocument();
    expect(screen.getAllByText("informe à mão")).toHaveLength(2);
    expect(screen.getByText("sem apuração")).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll(".fe-comb-mes-ref")).map((e) => e.textContent ?? "").some((t) => /ERP:.*2\.016,17/.test(t))).toBe(true);
  });

  test("apagar o campo de um mês informado envia null (volta a usar a apuração); mês nunca informado não envia nada", async () => {
    mock.mockResolvedValue({
      aplicado: false,
      previa: previa({ meses: [
        { chave: mes(2), valor: 1500, origem: "APURACAO", apuracaoErp: 1500 }, { chave: mes(4), valor: 2593.97, origem: "INFORMADA", apuracaoErp: 2016.17 },
      ] }),
    });
    abrir();
    fireEvent.change(await screen.findByLabelText("Gorjeta de 04/2026"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Gorjeta de 02/2026"), { target: { value: "1.800,00" } });
    fireEvent.click(screen.getByRole("button", { name: /Recalcular prévia/ }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(mock.mock.calls[1]).toEqual(["pi1", false, { "2026-02": 1800, "2026-04": null }]);
  });

  test("Gerar PDF sai como prévia antes de confirmar e como gravado depois", async () => {
    const pdf = vi.mocked(gerarPdfComplementoFerias);
    pdf.mockClear();
    mock.mockResolvedValueOnce({ aplicado: false, previa: previa() }).mockResolvedValueOnce({ aplicado: true, previa: previa() });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar PDF" }));
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(1));
    expect(pdf.mock.calls[0][1]).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e somar ao título" }));
    await screen.findByText("Complemento gravado no título de férias.");
    fireEvent.click(screen.getByRole("button", { name: "Gerar PDF" }));
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(2));
    expect(pdf.mock.calls[1][1]).toBe(true);
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
