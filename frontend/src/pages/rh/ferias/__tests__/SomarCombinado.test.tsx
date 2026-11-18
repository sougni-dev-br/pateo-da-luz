import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, type PreviaFeriasCombinado } from "../../../../api/client";

vi.mock("../../../../api/client", async (original) => ({ ...(await original<typeof import("../../../../api/client")>()), somarCombinadoAFerias: vi.fn() }));
import { somarCombinadoAFerias } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { SomarCombinado, lerValor } from "../SomarCombinado";

// Valores FICTÍCIOS: combinado 6.000, média da gorjeta 1.500, recibo líquido 6.000 → título 10.000.
const meses = (ausentes: string[] = []) => Array.from({ length: 12 }, (_, i) => {
  const chave = `2026-${String(i + 1).padStart(2, "0")}`;
  return ausentes.includes(chave) ? { chave, valor: null, origem: "AUSENTE" as const } : { chave, valor: 1500, origem: "APURACAO" as const };
});
const previa = (o: Partial<PreviaFeriasCombinado> = {}): PreviaFeriasCombinado => ({
  payrollItemId: "t1", employeeId: "e1", nome: "Ana Exemplo", combinado: 6000, mediaGorjeta: 1500, mesesContados: 12, mesesAusentes: [], meses: meses(),
  remuneracao: 10000, liquidoRecibo: 6000, complemento: 4000, valorAntes: 6000, valorDepois: 10000,
  formula: "(combinado R$ 6.000,00 + média R$ 1.500,00) × 4/3 = R$ 10.000,00", avisos: [], ...o,
});
const SESSAO = { hideSensitiveValues: false, toggleSensitiveValues: () => undefined } as unknown as SessionContextValue;
const abrir = () => {
  const onClose = vi.fn();
  const onAplicou = vi.fn();
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><SomarCombinado pagamentoId="t1" nome="Ana Exemplo" onClose={onClose} onAplicou={onAplicou} /></HideValuesProvider>
    </SessionContext.Provider>,
  );
  return { onClose, onAplicou };
};

beforeEach(() => { vi.mocked(somarCombinadoAFerias).mockReset(); });

describe("SomarCombinado", () => {
  test("ao abrir, pede só a prévia (nada é gravado) e mostra a conta e a fórmula", async () => {
    vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, previa: previa() });
    abrir();
    expect(await screen.findByText(/× 4\/3 = R\$ 10\.000,00/)).toBeInTheDocument();
    expect(somarCombinadoAFerias).toHaveBeenCalledWith("t1", false, undefined);
    expect(screen.getByText("Ana Exemplo")).toBeInTheDocument();
    expect(screen.getAllByText(/10\.000,00/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Somar ao título/ })).toBeEnabled();
  });

  test("Somar ao título grava (aplicar=true), avisa a tela e mostra o resultado", async () => {
    vi.mocked(somarCombinadoAFerias).mockResolvedValueOnce({ aplicado: false, previa: previa() }).mockResolvedValueOnce({ aplicado: true, previa: previa() });
    const { onAplicou } = abrir();
    fireEvent.click(await screen.findByRole("button", { name: /Somar ao título/ }));
    await waitFor(() => expect(somarCombinadoAFerias).toHaveBeenLastCalledWith("t1", true, undefined));
    expect(await screen.findByText(/Somado ao título/)).toBeInTheDocument();
    expect(onAplicou).toHaveBeenCalledTimes(1);
  });

  test("mês sem apuração: campo para informar à mão; Recalcular manda os valores digitados e Somar também", async () => {
    const ausentes = ["2026-01", "2026-02"];
    vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, previa: previa({ meses: meses(ausentes), mesesAusentes: ausentes, mesesContados: 10, avisos: ["2 mês(es) sem apuração nem valor informado"] }) });
    abrir();
    const janeiro = await screen.findByLabelText("Gorjeta integral de 01/2026");
    fireEvent.change(janeiro, { target: { value: "1.200,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
    await waitFor(() => expect(somarCombinadoAFerias).toHaveBeenLastCalledWith("t1", false, { "2026-01": 1200.5 }));
    fireEvent.click(screen.getByRole("button", { name: /Somar ao título/ }));
    await waitFor(() => expect(somarCombinadoAFerias).toHaveBeenLastCalledWith("t1", true, { "2026-01": 1200.5 }));
    expect(screen.getByText(/sem apuração nem valor informado/)).toBeInTheDocument();
  });

  test("valor digitado inválido não é enviado: avisa e não chama a API", async () => {
    vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, previa: previa({ meses: meses(["2026-01"]) }) });
    abrir();
    fireEvent.change(await screen.findByLabelText("Gorjeta integral de 01/2026"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Valor inválido/);
    expect(somarCombinadoAFerias).toHaveBeenCalledTimes(1);
  });

  test("nada a somar: botão de somar fica desabilitado e explica", async () => {
    vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, motivo: "Nada a somar.", previa: previa({ complemento: 0, valorDepois: 6000 }) });
    abrir();
    expect(await screen.findByText(/Nada a somar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Somar ao título/ })).toHaveAttribute("aria-disabled", "true");
  });

  test("recusa da API (sem combinado, pago, sem permissão) aparece como mensagem e não deixa somar", async () => {
    vi.mocked(somarCombinadoAFerias).mockRejectedValue(new ApiError("Ana Exemplo não tem salário combinado vigente em 12/2026: não há o que somar.", 422, {}));
    abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent(/não tem salário combinado/);
    expect(screen.queryByRole("button", { name: /Somar ao título/ })).not.toBeInTheDocument();
  });

  test("Esc fecha o modal", async () => {
    vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, previa: previa({ valorAntes: 10000, valorDepois: 10800, complemento: 4800 }) });
    const { onClose } = abrir();
    await screen.findByText(/Somar ao título/);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  test("digitar no campo não puxa o foco de volta para a janela (cada tecla re-renderiza)", async () => {
    vi.mocked(somarCombinadoAFerias).mockResolvedValue({ aplicado: false, previa: previa({ meses: meses(["2026-01"]) }) });
    abrir();
    const campo = await screen.findByLabelText("Gorjeta integral de 01/2026");
    campo.focus();
    for (const texto of ["1", "12", "120", "1200"]) {
      act(() => { fireEvent.change(campo, { target: { value: texto } }); });
      expect(document.activeElement).toBe(campo);
    }
  });

  test("falha ao gravar mantém a prévia e os valores digitados e deixa tentar de novo", async () => {
    vi.mocked(somarCombinadoAFerias)
      .mockResolvedValueOnce({ aplicado: false, previa: previa({ meses: meses(["2026-01"]) }) })
      .mockRejectedValueOnce(new ApiError("O valor do título foi ajustado à mão.", 409, {}))
      .mockResolvedValueOnce({ aplicado: true, previa: previa() });
    const { onAplicou } = abrir();
    fireEvent.change(await screen.findByLabelText("Gorjeta integral de 01/2026"), { target: { value: "1.200" } });
    fireEvent.click(screen.getByRole("button", { name: /Somar ao título/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ajustado à mão/);
    expect(screen.getByLabelText("Gorjeta integral de 01/2026")).toHaveValue("1.200");
    fireEvent.click(screen.getByRole("button", { name: /Somar ao título/ }));
    await waitFor(() => expect(onAplicou).toHaveBeenCalledTimes(1));
    expect(vi.mocked(somarCombinadoAFerias).mock.calls[2]).toEqual(["t1", true, { "2026-01": 1200 }]);
  });

  test("clique repetido em Somar enquanto grava não envia duas vezes", async () => {
    let termina: (v: { aplicado: boolean; previa: PreviaFeriasCombinado }) => void = () => undefined;
    vi.mocked(somarCombinadoAFerias).mockResolvedValueOnce({ aplicado: false, previa: previa() })
      .mockReturnValueOnce(new Promise((ok) => { termina = ok; }));
    abrir();
    const botao = await screen.findByRole("button", { name: /Somar ao título/ });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(somarCombinadoAFerias).toHaveBeenCalledTimes(2); // prévia + uma gravação
    await act(async () => { termina({ aplicado: true, previa: previa() }); });
  });
});

describe("lerValor (formato brasileiro, sem adivinhar)", () => {
  test.each([["1.200,50", 1200.5], ["1200,50", 1200.5], ["1.200", 1200], ["1200", 1200], ["0,5", 0.5], ["0", 0], ["12.345.678", 12345678]])("%s → %s", (texto, esperado) => {
    expect(lerValor(texto)).toBe(esperado);
  });
  test("vazio = não informado", () => { expect(lerValor("  ")).toBeNull(); });
  test.each(["abc", "1,200.50", "1.2", "1,234", "-5", "1..200", "1.200,555", "R$ 10"])("%s é inválido (NaN)", (texto) => {
    expect(Number.isNaN(lerValor(texto))).toBe(true);
  });
});
