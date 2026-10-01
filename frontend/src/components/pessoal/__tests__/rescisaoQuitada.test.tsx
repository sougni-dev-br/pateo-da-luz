import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rescisão calculada aqui com líquido zero ou negativo (regra do Eli, 01/10/2026): não
// bloqueia; lança como quitada (nada a pagar) e, se negativo, o saldo devedor é perdoado.
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTerminationInfo: vi.fn(),
  releaseTermination: vi.fn(),
}));

import { type ApuracaoRescisao, type TerminationInfo, getTerminationInfo, releaseTermination } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { RescisaoFormulario } from "../RescisaoFormulario";
import { RescisaoLancadaPainel } from "../RescisaoLancada";
import { quitacaoDoLiquido } from "../rescisaoFormato";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const semEspacoDuro = (t: string | null) => (t ?? "").replace(/\s/g, " ");

describe("quitacaoDoLiquido", () => {
  test("líquido positivo: rescisão normal", () => {
    expect(quitacaoDoLiquido(0.01)).toBeNull();
  });
  test("líquido zero: quitada, nada perdoado", () => {
    expect(quitacaoDoLiquido(0)).toEqual({ perdoado: 0, mensagem: "Líquido zero: a rescisão fica quitada, nada a pagar." });
  });
  test("líquido negativo: quitada, o saldo devedor é perdoado", () => {
    const q = quitacaoDoLiquido(-153.23)!;
    expect(q.perdoado).toBe(153.23);
    expect(semEspacoDuro(q.mensagem)).toBe("Os descontos passam do bruto em R$ 153,23: o saldo devedor é perdoado e a rescisão fica quitada.");
  });
});

function apuracao(vales: number): ApuracaoRescisao {
  return {
    saida: "2026-09-12", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: vales, creditos: 0, liquido: -vales, entraNaRescisao: true },
    gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 9, salarioProporcional: 659.97 },
    gorjetaObservacao: null,
    sugestao: { salario: 659.97, gorjeta: 186.8, creditos: 0, vales, valesRotulo: "VALE-1", vtDesconto: 0, bruto: 846.77 },
  } as ApuracaoRescisao;
}
const info = (vales: number): TerminationInfo => ({
  employee: { id: "e1", name: "Ana Silva", terminationDate: "2026-09-12", terminationReason: null },
  vtItems: [], alreadyReleased: false, rescisaoId: null, apuracao: apuracao(vales), lancada: null,
});

beforeEach(() => vi.clearAllMocks());

describe("RescisaoFormulario — líquido zero ou negativo", () => {
  test("negativo: não bloqueia, explica o perdão, esconde parcelas e lança como quitada", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info(1000));
    vi.mocked(releaseTermination).mockResolvedValue({ id: "z1", amount: 0, installments: 1, items: [], quitadaSemValor: true, saldoDevedorPerdoado: 153.23 });
    const onGravou = vi.fn();
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={onGravou} mostrarApuracao={false} />);

    const botao = await screen.findByRole("button", { name: "Lançar como quitada" });
    expect(semEspacoDuro(screen.getByText(/Os descontos passam do bruto/).textContent))
      .toBe("Os descontos passam do bruto em R$ 153,23: o saldo devedor é perdoado e a rescisão fica quitada.");
    expect(screen.queryByText("Parcelas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Liberar para Contas a Pagar" })).toBeNull();

    fireEvent.click(botao);
    await waitFor(() => expect(onGravou).toHaveBeenCalled());
    expect(vi.mocked(releaseTermination).mock.calls[0][1]).toMatchObject({ installments: 1, valesDiscount: 1000 });
    expect(semEspacoDuro((await screen.findByText(/Rescisão lançada como quitada/)).textContent))
      .toBe("Rescisão lançada como quitada: saldo devedor de R$ 153,23 perdoado, nada a pagar.");
  });

  test("zero: mensagem de quitada sem perdão", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info(846.77));
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    expect(await screen.findByRole("button", { name: "Lançar como quitada" })).toBeTruthy();
    expect(screen.getByText("Líquido zero: a rescisão fica quitada, nada a pagar.")).toBeTruthy();
  });

  test("positivo: continua liberando para Contas a Pagar, com parcelas", async () => {
    vi.mocked(getTerminationInfo).mockResolvedValue(info(100));
    render(<RescisaoFormulario funcionario={{ id: "e1", nome: "Ana Silva", semRegistro: true }} onGravou={vi.fn()} mostrarApuracao={false} />);
    expect(await screen.findByRole("button", { name: "Liberar para Contas a Pagar" })).toBeTruthy();
    expect(screen.getByText("Parcelas")).toBeTruthy();
    expect(screen.queryByText(/fica quitada/)).toBeNull();
  });
});

describe("RescisaoLancadaPainel — quitada sem valor", () => {
  test("mostra quitada e o perdoado, sem mandar estornar nem ajustar", () => {
    render(<RescisaoLancadaPainel ajustando={false} onAjustar={vi.fn()} lancada={{
      bruto: 846.77, salario: 659.97, gorjeta: 186.8, vales: 1000, vtDesconto: 0, outroDesconto: 0, liquido: 0,
      outroDescontoRotulo: null, valesRotulo: null, notes: null, ajusteManual: null, historicoAjustes: [],
      parcelas: [{ id: "z1", rotulo: "Rescisão (quitada)", valor: 0, vencimento: "2026-09-12T00:00:00.000Z", paga: true }],
      algumaPaga: true, quitadaSemValor: { saldoDevedorPerdoado: 153.23 },
    }} />);
    expect(screen.getByText("quitada: nada a pagar")).toBeTruthy();
    expect(semEspacoDuro(screen.getByText(/Saldo devedor perdoado/).closest("div")!.textContent)).toContain("153,23");
    expect(screen.queryByText(/estorne/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajustar rescisão" })).toBeNull();
  });
});
