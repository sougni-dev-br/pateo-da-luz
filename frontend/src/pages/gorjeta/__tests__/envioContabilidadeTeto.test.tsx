import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaPagamento } from "../AbaPagamento";
import { gorjetaEnviada, montarEnvioContabilidade } from "../envioContabilidade";
import { toRows } from "../gorjetaUtils";

// O PDF: captura o que vai para a tabela, sem gerar arquivo.
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
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: "c1", companyName: "Pateo Frei", functionName: null,
    isActive: true, semRegistro: false, foraDaGorjeta: false, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 2,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    outrosDias: 0, diasPrevistosOverride: null, diasElegiveis: 31, diasReferencia: 26,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true },
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
const eli = (over: Partial<TipComputedParticipant> = {}) => pessoa({
  employeeId: "eli", employeeName: "Elioenai Silva", rateioAmount: 2223.54, netCommission: 2223.54, baseSalary: 3672,
  gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000, ...over,
});
const ana = pessoa({ employeeId: "ana", employeeName: "Ana Souza", netCommission: 500, rateioAmount: 500, gorjetaInformada: 500 });

function comp(participants: TipComputedParticipant[]): TipComputation {
  return {
    year: 2026, month: 9, label: "Gorjeta 26/08–25/09", participants, reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0,
    adiantamento: { percent: 40, dia: 20 },
  } as unknown as TipComputation;
}
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("gorjeta enviada à contabilidade", () => {
  test("pelo teto: a informada; sem teto: a líquida; backend antigo (sem o campo): a líquida", () => {
    expect(gorjetaEnviada(eli())).toBe(1328);
    expect(gorjetaEnviada(ana)).toBe(500);
    expect(gorjetaEnviada(pessoa({ netCommission: 42, gorjetaInformada: undefined, gorjetaInformadaPeloTeto: undefined }))).toBe(42);
  });
  test("pelo teto sem permissão (valor null): null, nunca a gorjeta real", () => {
    expect(gorjetaEnviada(eli({ gorjetaInformada: null, tetoIrGorjeta: null, baseSalary: null }))).toBeNull();
  });
  test("o envio soma a informada e conta quem ficou oculto", () => {
    const e = montarEnvioContabilidade(comp([eli(), ana, pessoa({ employeeId: "sr", semRegistro: true })]));
    expect(e.linhas.map((l) => [l.pessoa.employeeId, l.gorjeta])).toEqual([["ana", 500], ["eli", 1328]]);
    expect(e.total).toBe(1828);
    expect(e.ocultos).toBe(0);
    const sem = montarEnvioContabilidade(comp([eli({ gorjetaInformada: null }), ana]));
    expect(sem.ocultos).toBe(1);
    expect(sem.total).toBeNull();
  });
});

describe("PDF do envio à contabilidade", () => {
  test("leva a gorjeta informada e o total por ela, sem nada do teto", async () => {
    await exportarContabilidade(comp([eli(), ana]));
    const t = tabelas[0] as { body: string[][]; foot: string[][] };
    const linhaEli = t.body.find((l) => l[0].startsWith("Elioenai"))!;
    expect(linhaEli[1]).toMatch(/1\.328,00/);
    expect(t.foot[0][1]).toMatch(/1\.828,00/);
    expect(textos.join(" ")).toMatch(/Total geral de gorjetas/);
    expect(textos.join(" ")).toMatch(/1\.828,00/);
    const tudo = JSON.stringify(t) + textos.join(" ");
    expect(tudo).not.toMatch(/teto|2\.223,54|5\.000/i);
  });
  test("sem permissão e alguém pelo teto: não gera e explica", async () => {
    await expect(exportarContabilidade(comp([eli({ gorjetaInformada: null }), ana]))).rejects.toThrow(/permissão de ver Funcionários/);
    expect(tabelas).toHaveLength(0);
  });
});

describe("envio à contabilidade na tela", () => {
  test("mostra a informada com o selo e a dica da gorjeta real; total pela informada", () => {
    const c = comp([eli(), ana]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const linha = screen.getByText("Elioenai Silva").closest("tr")!;
    expect(within(linha).getByText("1.328,00")).toBeTruthy();
    const selo = within(linha).getByText("pelo teto do IR");
    expect(selo.closest("[title]")!.getAttribute("title")).toMatch(/^gorjeta real R\$\s2\.223,54; a diferença ele recebe na lista de pagamento$/);
    const total = screen.getByText("Total a lançar").closest("tr")!;
    expect(within(total).getByText("1.828,00")).toBeTruthy();
  });

  test("sem permissão: traço com explicação, sem a gorjeta real no lugar", () => {
    const c = comp([eli({ gorjetaInformada: null, tetoIrGorjeta: null, baseSalary: null }), ana]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const linha = screen.getByText("Elioenai Silva").closest("tr")!;
    const traco = within(linha).getByTitle(/permissão de ver Funcionários/);
    expect(traco.textContent).toContain("—");
    expect(within(linha).queryByText("2.223,54")).toBeNull();
    const total = screen.getByText("Total a lançar").closest("tr")!;
    expect(within(total).queryByText("500,00")).toBeNull();
  });
});
