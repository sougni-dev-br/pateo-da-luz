import { fireEvent, render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaApuracao } from "../AbaApuracao";
import { toRows } from "../gorjetaUtils";

// Apuração: "Afastamento (dias)" vem da Escala (não se digita) e segue a regra de desconto
// do período ou da pessoa — riscado quando a pessoa recebe a gorjeta integral.
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: null, companyName: null, functionName: null,
    isActive: true, semRegistro: false, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 4,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    afastamento: 0, afastamentoOrigem: "ESCALA",
    escala: { faltas: 0, atestados: 0, ferias: 0, afastamento: 0 }, folgasEscala: { total: 0, folga: 0, feriado: 0, bancoHoras: 0 },
    outrosDias: 0, diasPrevistosOverride: null, diasElegiveis: 31, diasReferencia: 26,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null, descontaAfastamento: null },
    regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true, descontaAfastamento: true },
    diasPrevistos: 26, diasComputados: 26, fatorPresenca: 1, pontosApurados: 4, points: 4, pontosDireito: 4, pontosDevolvidos: 0, extraRescisao: 0,
    justificativaExtra: null, tipoCalculo: "MES", valorPonto: 222.35, rescisaoServicoBruto: null, rescisaoServicoOrigem: null, rescisaoValorFixo: null,
    pagoNaRescisao: false, rescisaoRecibo: null, rescisaoContasPagar: null, gorjetaCalculada: 889.4, gorjetaReal: null, rescisaoPendente: false,
    rateioAmount: 889.4, descontos: 0, creditos: 0, valesTotal: 0, netCommission: 889.4, diasSalarioOverride: null, diasSalario: 30,
    salarioProporcional: 0, adiantamentoSalarial: null, totalAPagar: 889.4, baseSalary: null, pixKeyType: null, pixKey: null,
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    ...over,
  } as TipComputedParticipant;
}

const comp = (participants: TipComputedParticipant[], over: Partial<TipComputation> = {}) =>
  ({ year: 2026, month: 9, participants, sobraRescisaoParaSaldo: false, descontaFalta: true, descontaAtestado: true, descontaFerias: true,
    descontaOutros: false, descontaAfastamento: true, proporcionalEntrada: true, ...over } as unknown as TipComputation);

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

function renderApuracao(c: TipComputation, onRow = vi.fn()) {
  render(
    <AbaApuracao comp={c} rows={toRows(c)} readonly={false} onRow={onRow} onRemove={vi.fn()} onVerVales={vi.fn()}
      recibo={{ antesDeGravar: vi.fn(), onAplicado: vi.fn(), onErro: vi.fn() }} onGorjetaReal={vi.fn()} />,
  );
  return onRow;
}

describe("coluna Afastamento (dias)", () => {
  test("mostra os dias da Escala; desconta pela regra (title explica)", () => {
    renderApuracao(comp([pessoa({ employeeId: "a", employeeName: "Ana Afastada", afastamento: 26, diasComputados: 4, pontosApurados: 0.62, points: 0.62 })]));
    const th = screen.getAllByRole("columnheader", { name: /Afast/ })[0];
    expect(th.getAttribute("title")).toMatch(/Afastamento não remunerado/);
    const linha = screen.getByText("Ana Afastada").closest("tr")!;
    const celula = within(linha).getByLabelText("Afastamento de Ana Afastada");
    expect(celula.textContent).toBe("26");
    expect(celula.getAttribute("title")).toMatch(/desconta na gorjeta/);
    expect(celula.style.textDecoration).toBe("");
  });

  test("gorjeta integral para a pessoa: o número sai riscado e o title diz que não desconta", () => {
    renderApuracao(comp([pessoa({
      employeeId: "a", employeeName: "Ana Integral", afastamento: 26,
      regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null, descontaAfastamento: false },
      regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true, descontaAfastamento: false },
    })]));
    const celula = within(screen.getByText("Ana Integral").closest("tr")!).getByLabelText("Afastamento de Ana Integral");
    expect(celula.style.textDecoration).toBe("line-through");
    expect(celula.getAttribute("title")).toMatch(/gorjeta integral/);
  });

  test("sem afastamento: traço", () => {
    renderApuracao(comp([pessoa({ employeeName: "Bia" })]));
    expect(within(screen.getByText("Bia").closest("tr")!).getByLabelText("Afastamento de Bia").textContent).toBe("—");
  });

  test("as regras da pessoa trazem 'Descontar afastamento' e gravam a escolha", () => {
    const onRow = renderApuracao(comp([pessoa({ employeeId: "a", employeeName: "Ana", afastamento: 26 })]));
    fireEvent.click(screen.getByRole("button", { name: "Regras de presença de Ana" }));
    const dialogo = screen.getByRole("dialog", { name: "Regras de presença de Ana" });
    const select = within(dialogo).getByLabelText(/Descontar afastamento não remunerado/) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getByRole("option", { name: "Padrão (sim)" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "nao" } });
    expect(onRow).toHaveBeenCalledWith("a", expect.objectContaining({ regras: expect.objectContaining({ descontaAfastamento: false }) }));
  });
});
