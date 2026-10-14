import { describe, expect, test } from "vitest";
import { montarResumo, MIN_DIAS_ANTERIOR } from "../agile-analise-resumo.js";
import type { VendaVisao } from "../agile-analise-visao.report.js";

const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const venda = (over: Partial<VendaVisao> & { saleId: string }): VendaVisao => ({
  movementDate: dia("2026-10-05"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:00", people: 2, totalAmount: 200,
  subtotalAmount: null, discountAmount: null, cancelledBy: null, cancelReason: null, ...over
});
// periodo de 10 dias: 2026-10-11..2026-10-20; anterior: 2026-10-01..2026-10-10
const periodo = { inicio: "2026-10-11", fim: "2026-10-20" };
const diasDe = (de: number, ate: number, mes = "2026-10") =>
  Array.from({ length: ate - de + 1 }, (_, i) => `${mes}-${String(de + i).padStart(2, "0")}`);
const vendasEm = (datas: string[], pessoas: number, valor: number, prefixo: string) =>
  datas.map((d, i) => venda({ saleId: `${prefixo}${i}`, movementDate: dia(d), people: pessoas, totalAmount: valor }));
const montar = (atual: VendaVisao[], anterior: VendaVisao[]) =>
  montarResumo({ periodo, vendasAtual: atual, vendasAnterior: anterior, itensCanceladosAtual: 0, itensCanceladosAnterior: 0 });

describe("montarResumo — periodo e cobertura", () => {
  test("o periodo anterior e o de mesmo tamanho imediatamente antes", () => {
    expect(montar([], []).periodoAnterior).toEqual({ inicio: "2026-10-01", fim: "2026-10-10" });
  });

  test("cobertura: dias do periodo, dias com movimento e primeiro/ultimo dia", () => {
    const r = montar(vendasEm(["2026-10-12", "2026-10-15"], 2, 200, "a"), []);
    expect(r.cobertura).toMatchObject({ diasNoPeriodo: 10, diasComMovimento: 2, primeiroDia: "2026-10-12", ultimoDia: "2026-10-15", vendasComDetalhe: 2 });
  });

  test("a serie tem um ponto por dia do periodo", () => {
    expect(montar(vendasEm(["2026-10-12"], 2, 200, "a"), []).serie).toHaveLength(10);
  });

  test("linha fora da janela nao contamina nenhum dos dois periodos", () => {
    const r = montar(
      [...vendasEm(["2026-10-12"], 2, 200, "a"), venda({ saleId: "fora", movementDate: dia("2026-11-30"), totalAmount: 99999 })],
      [...vendasEm(["2026-10-02"], 2, 100, "b"), venda({ saleId: "fora2", movementDate: dia("2026-08-01"), totalAmount: 99999 })]
    );
    expect(r.atual.faturamento).toBe(200);
    expect(r.anterior?.faturamento).toBe(100);
  });
});

describe("montarResumo — comparacao com o periodo anterior", () => {
  const atual = vendasEm(diasDe(11, 20), 50, 5000, "a"); // 10 dias x 50 pessoas
  const anteriorBom = vendasEm(diasDe(1, 10), 40, 4000, "b"); // 10 dias x 40 pessoas

  // Duas semanas inteiras: 2026-10-11..2026-10-24 contra 2026-09-27..2026-10-10.
  const periodo14 = { inicio: "2026-10-11", fim: "2026-10-24" };
  const atual14 = vendasEm(diasDe(11, 24), 50, 5000, "a");
  const anterior14 = [...vendasEm(diasDe(27, 30, "2026-09"), 40, 4000, "p"), ...vendasEm(diasDe(1, 10), 40, 4000, "q")];
  const montar14 = (p = periodo14, a = atual14, b = anterior14) =>
    montarResumo({ periodo: p, vendasAtual: a, vendasAnterior: b, itensCanceladosAtual: 0, itensCanceladosAnterior: 0 });

  test("com anterior confiavel e 14 dias ou mais, devolve as variacoes por dia", () => {
    const r = montar14();
    expect(r.anteriorConfiavel).toBe(true);
    expect(r.motivoSemComparacao).toBeNull();
    expect(r.comparacao?.pessoasPorDia).toEqual({ atual: 50, anterior: 40, diferenca: 10, pct: 0.25 });
    expect(r.comparacao?.faturamentoPorDia.pct).toBe(0.25);
    expect(r.comparacao?.ticketPessoa).toMatchObject({ atual: 100, anterior: 100, pct: 0 });
  });

  test("periodo curto (menos de 14 dias) NAO compara: sexta a domingo contra terca a quinta seria efeito do calendario", () => {
    const r = montar(atual, anteriorBom); // 10 dias
    expect(r.anteriorConfiavel).toBe(false);
    expect(r.comparacao).toBeNull();
    expect(r.motivoSemComparacao).toBe("periodo-curto");
    expect(r.anterior).not.toBeNull(); // o anterior existe, so nao serve de comparacao
  });

  test("o limite e inclusivo: 14 dias comparam, 13 nao", () => {
    expect(montar14().anteriorConfiavel).toBe(true);
    const treze = { inicio: "2026-10-12", fim: "2026-10-24" };
    const r13 = montarResumo({ periodo: treze, vendasAtual: vendasEm(diasDe(12, 24), 50, 5000, "a"), vendasAnterior: [...vendasEm(diasDe(29, 30, "2026-09"), 40, 4000, "p"), ...vendasEm(diasDe(1, 11), 40, 4000, "q")], itensCanceladosAtual: 0, itensCanceladosAnterior: 0 });
    expect(r13.anteriorConfiavel).toBe(false);
    expect(r13.motivoSemComparacao).toBe("periodo-curto");
  });

  test("periodo longo com base anterior fraca: motivo e base-fraca, nao periodo-curto", () => {
    const r = montar14(periodo14, atual14, vendasEm(diasDe(1, 2), 40, 4000, "q"));
    expect(r.anteriorConfiavel).toBe(false);
    expect(r.motivoSemComparacao).toBe("base-fraca");
  });

  test("sem nenhum anterior em periodo longo: base-fraca", () => {
    expect(montar14(periodo14, atual14, []).motivoSemComparacao).toBe("base-fraca");
  });

  test("sem nenhuma venda no anterior: sem comparacao e sem 'anterior'", () => {
    const r = montar(atual, []);
    expect(r.anterior).toBeNull();
    expect(r.comparacao).toBeNull();
    expect(r.anteriorConfiavel).toBe(false);
  });

  test("anterior com pouca cobertura (menos da metade dos dias) nao serve de base", () => {
    const r = montar(atual, vendasEm(diasDe(1, 4), 100, 10000, "b"));
    expect(r.anterior).not.toBeNull();
    expect(r.anteriorConfiavel).toBe(false);
    expect(r.comparacao).toBeNull();
  });

  test("anterior com menos do minimo de dias nao serve, mesmo que seja metade do periodo curto", () => {
    const r = montarResumo({
      periodo: { inicio: "2026-10-03", fim: "2026-10-04" },
      vendasAtual: vendasEm(["2026-10-03", "2026-10-04"], 10, 1000, "a"),
      vendasAnterior: vendasEm(["2026-10-01"], 10, 1000, "b"),
      itensCanceladosAtual: 0,
      itensCanceladosAnterior: 0
    });
    expect(MIN_DIAS_ANTERIOR).toBe(3);
    expect(r.anteriorConfiavel).toBe(false);
  });

  test("os itens cancelados de cada janela entram na perda da sua janela", () => {
    const r = montarResumo({ periodo, vendasAtual: atual, vendasAnterior: anteriorBom, itensCanceladosAtual: 500, itensCanceladosAnterior: 100 });
    expect(r.atual.itensCanceladosValor).toBe(500);
    expect(r.anterior?.itensCanceladosValor).toBe(100);
  });
});

describe("montarResumo — avisos", () => {
  test("queda de movimento contra o periodo anterior vira aviso no resumo (com 14 dias, duas semanas)", () => {
    const quinzeDias = { inicio: "2026-10-15", fim: "2026-10-28" };
    const r = montarResumo({
      periodo: quinzeDias,
      vendasAtual: vendasEm(diasDe(15, 28), 30, 3000, "a"),
      vendasAnterior: vendasEm(diasDe(1, 14), 50, 5000, "b"),
      itensCanceladosAtual: 0,
      itensCanceladosAnterior: 0
    });
    expect(r.insights.map((i) => i.id)).toContain("pessoas-variacao");
  });

  test("com menos de 14 dias nao compara, mesmo com queda grande", () => {
    const r = montar(vendasEm(diasDe(11, 20), 30, 3000, "a"), vendasEm(diasDe(1, 10), 50, 5000, "b"));
    expect(r.insights.map((i) => i.id)).not.toContain("pessoas-variacao");
  });

  test("periodo vazio: tudo zerado e sem avisos", () => {
    const r = montar([], []);
    expect(r.atual.faturamento).toBe(0);
    expect(r.insights).toEqual([]);
    expect(r.cobertura).toMatchObject({ diasComMovimento: 0, primeiroDia: null, ultimoDia: null });
  });
});
