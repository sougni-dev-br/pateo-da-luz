import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaPagamento } from "../AbaPagamento";
import { toRows } from "../gorjetaUtils";

// CLT com afastamento não remunerado no período: a contabilidade precisa saber. A coluna
// "Afast." (dias) aparece no PDF e na tela só quando alguém tem.
const tabelas: Array<Record<string, unknown>> = [];
const textos: string[] = [];
vi.mock("jspdf", () => ({
  jsPDF: class {
    lastAutoTable = { finalY: 50 };
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setDrawColor() {}
    setFillColor() {}
    setLineWidth() {}
    line() {}
    rect() {}
    roundedRect() {}
    addPage() {}
    setPage() {}
    getNumberOfPages() { return 1; }
    getTextWidth(t: string) { return t.length * 1.5; }
    text(t: string | string[]) { textos.push(Array.isArray(t) ? t.join(" ") : t); }
    save() {}
  },
}));
vi.mock("jspdf-autotable", () => ({ default: (_doc: unknown, opts: Record<string, unknown>) => { tabelas.push(opts); } }));
import { exportarContabilidade } from "../exportarPdf";

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); tabelas.length = 0; textos.length = 0; });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: "c1", companyName: "Empresa Exemplo", functionName: null,
    isActive: true, semRegistro: false, foraDaGorjeta: false, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 2,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    afastamento: 0, afastamentoOrigem: "ESCALA",
    outrosDias: 0, diasPrevistosOverride: null, diasElegiveis: 31, diasReferencia: 26,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true, descontaAfastamento: true },
    diasPrevistos: 26, diasComputados: 26, fatorPresenca: 1, pontosApurados: 2, points: 2, pontosDireito: 2, pontosDevolvidos: 0, extraRescisao: 0,
    justificativaExtra: null, tipoCalculo: "MES", valorPonto: 150, rescisaoServicoBruto: null, rescisaoServicoOrigem: null, rescisaoValorFixo: null,
    pagoNaRescisao: false, rescisaoRecibo: null, rescisaoContasPagar: null, gorjetaCalculada: 300, gorjetaReal: null, rescisaoPendente: false,
    rateioAmount: 300, descontos: 0, creditos: 0, valesTotal: 0, netCommission: 300, diasSalarioOverride: null, diasSalario: 30,
    salarioProporcional: 0, adiantamentoSalarial: 0, totalAPagar: 0, baseSalary: 2000, pixKeyType: null, pixKey: null,
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    gorjetaInformada: 300, gorjetaInformadaPeloTeto: false, tetoIrGorjeta: null,
    ...over,
  } as TipComputedParticipant;
}
const comp = (participants: TipComputedParticipant[]) => ({
  year: 2026, month: 9, label: "Gorjeta 26/08–25/09", periodStart: "2026-08-26T00:00:00.000Z", periodEnd: "2026-09-25T00:00:00.000Z",
  participants, reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0, adiantamento: { percent: 40, dia: 20 },
}) as unknown as TipComputation;
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const ana = pessoa({ employeeId: "ana", employeeName: "Ana Lima", afastamento: 20 });
const bia = pessoa({ employeeId: "bia", employeeName: "Bia Reis" });

describe("PDF do envio à contabilidade", () => {
  test("com afastamento: coluna Afast., resumo com afast. e legenda explicando", async () => {
    await exportarContabilidade(comp([ana, bia]));
    const t = tabelas[0] as { head: string[][]; body: string[][]; foot: string[][] };
    expect(t.head[0]).toContain("Afast.");
    expect(t.body.find((l) => l[0] === "Ana Lima")!.slice(-1)[0]).toBe("20");
    expect(t.body.find((l) => l[0] === "Bia Reis")!.slice(-1)[0]).toBe("-");
    expect(t.foot[0]).toHaveLength(t.head[0].length);
    const tudo = textos.join(" | ");
    expect(tudo).toContain("FALTAS / ATESTADOS / AFAST.");
    expect(tudo).toMatch(/afastamento não remunerado \(Afast\.\) em dias/);
  });

  test("sem ninguém afastado: tabela como sempre, sem a coluna", async () => {
    await exportarContabilidade(comp([bia]));
    const t = tabelas[0] as { head: string[][] };
    expect(t.head[0]).not.toContain("Afast.");
    expect(textos.join(" | ")).toContain("FALTAS / ATESTADOS");
    expect(textos.join(" | ")).not.toContain("AFAST.");
  });
});

describe("envio à contabilidade na tela", () => {
  test("coluna Afast. aparece só quando alguém tem afastamento", () => {
    const c = comp([ana, bia]);
    const { unmount } = render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: /Afast\./ })).toBeTruthy();
    expect(within(screen.getByText("Ana Lima").closest("tr")!).getByText("20")).toBeTruthy();
    unmount();

    const s = comp([bia]);
    render(<AbaPagamento comp={s} rows={toRows(s)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole("columnheader", { name: /Afast\./ })).toBeNull();
  });
});
