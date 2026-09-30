import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaApuracao, Ocorrencia } from "../AbaApuracao";
import { toRows } from "../gorjetaUtils";

// Apuração: folgas da Escala só aparecem (coluna própria, detalhe no title) e o valor
// digitado que difere da Escala mostra "escala: N" embaixo.
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: null, companyName: null, functionName: null,
    isActive: true, semRegistro: false, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 2,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    escala: { faltas: 0, atestados: 0, ferias: 0 }, folgasEscala: { total: 0, folga: 0, feriado: 0, bancoHoras: 0 },
    outrosDias: 0, diasPrevistosOverride: null, diasElegiveis: 31, diasReferencia: 26,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true },
    diasPrevistos: 26, diasComputados: 26, fatorPresenca: 1, pontosApurados: 2, points: 2, pontosDireito: 2, pontosDevolvidos: 0, extraRescisao: 0,
    justificativaExtra: null, tipoCalculo: "MES", valorPonto: 150, rescisaoServicoBruto: null, rescisaoServicoOrigem: null, rescisaoValorFixo: null,
    pagoNaRescisao: false, rescisaoRecibo: null, rescisaoContasPagar: null, gorjetaCalculada: 300, gorjetaReal: null, rescisaoPendente: false,
    rateioAmount: 300, descontos: 0, creditos: 0, valesTotal: 0, netCommission: 300, diasSalarioOverride: null, diasSalario: 30,
    salarioProporcional: 0, adiantamentoSalarial: null, totalAPagar: 300, baseSalary: null, pixKeyType: null, pixKey: null,
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    ...over,
  } as TipComputedParticipant;
}

const comp = (participants: TipComputedParticipant[]) =>
  ({ year: 2026, month: 9, participants, sobraRescisaoParaSaldo: false } as unknown as TipComputation);

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

function renderApuracao(c: TipComputation) {
  return render(
    <AbaApuracao comp={c} rows={toRows(c)} readonly={false} onRow={vi.fn()} onRemove={vi.fn()} onVerVales={vi.fn()}
      recibo={{ antesDeGravar: vi.fn(), onAplicado: vi.fn(), onErro: vi.fn() }} onGorjetaReal={vi.fn()} />,
  );
}

describe("coluna Folgas (escala)", () => {
  test("mostra o total com o detalhe no title, e traço para retrato antigo", () => {
    const c = comp([
      pessoa({ employeeId: "a", employeeName: "Ana Folgas", folgasEscala: { total: 6, folga: 4, feriado: 1, bancoHoras: 1 } }),
      pessoa({ employeeId: "b", employeeName: "Bia Retrato Antigo", folgasEscala: null }),
    ]);
    renderApuracao(c);
    const th = screen.getAllByRole("columnheader", { name: /Folgas/ })[0];
    expect(th.getAttribute("title")).toMatch(/só informação/);
    const ana = screen.getByText("Ana Folgas").closest("tr")!;
    const seis = within(ana).getByText("6");
    expect(seis.getAttribute("title")).toBe("4 folga(s) · 1 de feriado · 1 de banco de horas — só informação, não entra no cálculo");
    const bia = screen.getByText("Bia Retrato Antigo").closest("tr")!;
    expect(within(bia).getByTitle(/Fechado antes/)).toBeTruthy();
  });

  test("pode ser ocultada pelo seletor de colunas (fica guardado no navegador)", () => {
    window.localStorage.setItem("gorjeta-colunas:apuracao", JSON.stringify(["folgas"]));
    renderApuracao(comp([pessoa({ employeeName: "Ana", folgasEscala: { total: 6, folga: 6, feriado: 0, bancoHoras: 0 } })]));
    expect(screen.queryByRole("columnheader", { name: /Folgas/ })).toBeNull();
  });
});

describe("digitado diferente da Escala", () => {
  test("faltas e atestados digitados que diferem mostram o número da Escala; igual não mostra", () => {
    const c = comp([pessoa({
      employeeName: "Caio",
      faltas: 1, faltasOrigem: "MANUAL", atestados: 2, atestadosOrigem: "MANUAL", ferias: 0, feriasOrigem: "MANUAL",
      escala: { faltas: 3, atestados: 2, ferias: 5 },
    })]);
    renderApuracao(c);
    const linha = screen.getByText("Caio").closest("tr")!;
    expect(within(linha).getByText("escala: 3")).toBeTruthy();
    expect(within(linha).getByText("escala: 5")).toBeTruthy();
    expect(within(linha).queryByText("escala: 2")).toBeNull();
  });

  test("vindo da Escala (campo vazio) não mostra o indicador", () => {
    render(<Ocorrencia value="" escala={2} naEscala={2} manual={false} disabled={false} label="Faltas" onChange={vi.fn()} />);
    expect(screen.queryByText(/escala:/)).toBeNull();
  });
});
