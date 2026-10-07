import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReciboPagamentoMes, ReciboPagoAntes } from "../../../api/client";

// Recibo de pagamento de quem não tem registro: texto, caracteres que a fonte desenha e uma
// folha por pessoa. Tudo que iria para o PDF é guardado pelo jsPDF falso. Dados fictícios.
const enviados: string[] = [];
let paginas = 1;
vi.mock("jspdf", () => ({
  jsPDF: class {
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setDrawColor() {}
    setLineWidth() {}
    setLineDashPattern() {}
    setProperties(p: { title: string }) { enviados.push(p.title); }
    line() {}
    rect() {}
    roundedRect() {}
    addPage() { paginas += 1; }
    splitTextToSize(t: string) { return [t]; }
    getTextWidth(t: string) { return t.length * 1.5; }
    text(t: string | string[]) { (Array.isArray(t) ? t : [t]).forEach((x) => enviados.push(x)); }
    output() { return new Blob(); }
  },
}));
import { gerarRecibosPagamento, linhasQueCabem, textoDoReciboPagamento } from "../reciboPagamento";

beforeEach(() => { enviados.length = 0; paginas = 1; });

const EXTRAS_CP1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•—˜™š›œžŸ";
const foraDoPdf = (s: string) => [...s].filter((c) => {
  const n = c.codePointAt(0)!;
  if (c === "\n") return false;
  if (n >= 0x20 && n <= 0x7e) return false;
  if (n >= 0xa0 && n <= 0xff) return false;
  return !EXTRAS_CP1252.includes(c);
});

const mes = (over: Partial<ReciboPagamentoMes> = {}): ReciboPagamentoMes => ({
  tipo: "PAGAMENTO_MES", employeeId: "e1", nome: "Fulana – de Tal Exemplo", cpf: "11122233344",
  competencia: "09/2026", referencia: "pagamento do mês de 09/2026",
  linhas: [
    { descricao: "Dias trabalhados", detalhe: "30 dias", valor: 2600 },
    { descricao: "Adiantamento já pago", detalhe: null, valor: -1040 },
    { descricao: "Gorjeta", detalhe: null, valor: 812.4 },
    { descricao: "Refeição: almoço − sábado", detalhe: "12/09/2026", valor: -35.5, vale: true },
    { descricao: "Crédito: troca de turno", detalhe: "20/09/2026", valor: 50, vale: true },
    { descricao: "Hora extra (50%)", detalhe: "6:00", valor: 106.36 },
    { descricao: "Adicional noturno", detalhe: "4:30", valor: 14.18 },
    { descricao: "DSR", detalhe: "sobre hora extra e noturno", valor: 27.79 },
  ],
  totalLista: 2535.23, acerto: null, total: 2535.23, dataPagamento: null,
  ...over,
});
const quinzena: ReciboPagoAntes = {
  tipo: "QUINZENA", id: "t1", employeeId: "e1", nome: "Fulana de Tal Exemplo", cpf: null,
  competencia: "09/2026", referencia: "1ª quinzena de 09/2026",
  linhas: [{ descricao: "1ª quinzena de 09/2026", detalhe: "metade do valor mensal de R$ 2.600,00", valor: 1300 }],
  total: 1300, dataPagamento: "2026-09-15",
};
const adiantamento: ReciboPagoAntes = {
  ...quinzena, tipo: "ADIANTAMENTO", id: "t2", referencia: "adiantamento de 09/2026",
  linhas: [{ descricao: "Adiantamento de 09/2026", detalhe: "40% do valor mensal de R$ 2.600,00", valor: 1040 }], total: 1040,
};

describe("texto do recibo", () => {
  test("pagamento do mês: importância por extenso e referência, sem empresa", () => {
    expect(textoDoReciboPagamento(mes()).replace(/ /g, " ")).toBe(
      "Recebi a importância de R$ 2.535,23 (dois mil quinhentos e trinta e cinco reais e vinte e três centavos), "
      + "referente ao pagamento do mês de 09/2026, conforme discriminado abaixo.",
    );
  });
  test("quinzena e adiantamento", () => {
    expect(textoDoReciboPagamento(quinzena)).toContain("referente à 1ª quinzena de 09/2026");
    expect(textoDoReciboPagamento(adiantamento)).toContain("referente ao adiantamento de 09/2026");
  });
});

describe("PDF", () => {
  test("título, discriminação, total, assinatura com CPF; sem empresa e sem 'salário'", async () => {
    await gerarRecibosPagamento([mes()]);
    const todos = enviados.join("\n");
    expect(enviados).toContain("RECIBO DE PAGAMENTO");
    expect(enviados).toContain("- R$ 1.040,00");
    expect(enviados).toContain("Total recebido");
    expect(enviados.filter((t) => t === "R$ 2.535,23").length).toBeGreaterThanOrEqual(2);
    expect(enviados).toContain("CPF 111.222.333-44");
    expect(enviados).toContain("FULANA - DE TAL EXEMPLO");
    expect(enviados.some((t) => /^São Paulo, \d+ de \w+ de \d{4}\.$/.test(t))).toBe(true);
    expect(enviados.some((t) => t.startsWith("Via da empresa"))).toBe(true);
    expect(enviados.some((t) => t.startsWith("Via do funcionário"))).toBe(true);
    expect(todos).not.toMatch(/sal[áa]rio|holerite|empregado|CNPJ|LTDA|raz[ãa]o social/i);
  });

  test("só caracteres que a fonte desenha: nada de − nem –", async () => {
    await gerarRecibosPagamento([mes(), quinzena, adiantamento]);
    const todos = enviados.join("\n");
    expect(todos).not.toMatch(/[−–‐]/);
    expect(foraDoPdf(todos)).toEqual([]);
  });

  test("sem CPF: linha para preencher; data do pagamento quando já pago", async () => {
    await gerarRecibosPagamento([quinzena]);
    expect(enviados).toContain("CPF: ______________________");
    expect(enviados).toContain("São Paulo, 15 de setembro de 2026.");
    expect(enviados).toContain("metade do valor mensal de R$ 2.600,00");
  });

  test("todos: uma página por pessoa com total > 0", async () => {
    await gerarRecibosPagamento([mes(), mes({ employeeId: "e2", nome: "Beltrano Exemplo" }), mes({ employeeId: "e3", total: 0 }), adiantamento]);
    expect(paginas).toBe(3);
    expect(enviados.filter((t) => t === "RECIBO DE PAGAMENTO")).toHaveLength(6); // duas vias por folha
  });

  test("nenhum com valor: erro claro", async () => {
    await expect(gerarRecibosPagamento([mes({ total: 0 })])).rejects.toThrow(/Nenhum recibo/);
  });
});

describe("muitos vales", () => {
  test("cabem: ficam um por um; não cabem: viram uma linha com a soma", () => {
    const linhas = mes().linhas;
    expect(linhasQueCabem(linhas, 20)).toBe(linhas);
    const juntas = linhasQueCabem(linhas, 7);
    expect(juntas.map((l) => l.descricao)).toEqual([
      "Dias trabalhados", "Adiantamento já pago", "Gorjeta", "Vales e créditos da gorjeta", "Hora extra (50%)", "Adicional noturno", "DSR",
    ]);
    expect(juntas[3]).toMatchObject({ valor: 14.5, detalhe: "2 lançamentos" });
    expect(juntas.reduce((a, l) => a + l.valor, 0)).toBeCloseTo(linhas.reduce((a, l) => a + l.valor, 0), 2);
  });
});
