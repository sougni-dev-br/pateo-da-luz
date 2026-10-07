import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReciboPagamentoMes, ReciboPagoAntes, ReciboPessoa } from "../../../api/client";

// Recibo de pagamento de quem não tem registro, no layout do holerite: texto, totais, caracteres
// que a fonte desenha, faixa da assinatura e uma folha por pessoa. Tudo que iria para o PDF é
// guardado pelo jsPDF falso. Dados fictícios.
const enviados: string[] = [];
const girados: string[] = [];
let paginas = 1;
vi.mock("jspdf", () => ({
  jsPDF: class {
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setDrawColor() {}
    setLineWidth() {}
    setProperties(p: { title: string }) { enviados.push(p.title); }
    line() {}
    rect() {}
    addPage() { paginas += 1; }
    splitTextToSize(t: string) { return [t]; }
    getTextWidth(t: string) { return t.length * 1.5; }
    text(t: string | string[], _x: number, _y: number, o?: { angle?: number }) {
      (Array.isArray(t) ? t : [t]).forEach((x) => { enviados.push(x); if (o?.angle === 90) girados.push(x); });
    }
    output() { return new Blob(); }
  },
}));
import {
  gerarRecibosPagamento, linhaDeParabens, mesDoPagamento, mesPorExtenso, textoDoReciboPagamento, totaisDoRecibo,
} from "../reciboPagamento";

beforeEach(() => { enviados.length = 0; girados.length = 0; paginas = 1; });

const EXTRAS_CP1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•—˜™š›œžŸ";
const foraDoPdf = (s: string) => [...s].filter((c) => {
  const n = c.codePointAt(0)!;
  if (c === "\n") return false;
  if (n >= 0x20 && n <= 0x7e) return false;
  if (n >= 0xa0 && n <= 0xff) return false;
  return !EXTRAS_CP1252.includes(c);
});

const pessoa: ReciboPessoa = {
  employeeId: "e1", nome: "Fulana – de Tal Exemplo", cpf: "11122233344", codigo: null, funcao: "Atendente ‐ salão",
  admissao: "2026-03-02", aniversario: "12/10", valorMensal: 2600,
};
const mes = (over: Partial<ReciboPagamentoMes> = {}): ReciboPagamentoMes => ({
  ...pessoa, tipo: "PAGAMENTO_MES", pagamentoQuinzenal: false, competencia: "09/2026", referencia: "pagamento do mês de 09/2026",
  linhas: [
    { codigo: 1, descricao: "DIAS TRABALHADOS", referencia: "30,00", valor: 2600 },
    { codigo: 203, descricao: "GORJETA", referencia: null, valor: 812.4 },
    { codigo: 201, descricao: "HORA EXTRA 50%", referencia: "6,00", valor: 106.36 },
    { codigo: 202, descricao: "ADICIONAL NOTURNO", referencia: "4,50", valor: 14.18 },
    { codigo: 250, descricao: "DSR S/ EXTRAS", referencia: null, valor: 27.79 },
    { codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "1.040,00", valor: -1040 },
    { codigo: 300, descricao: "CRÉDITO TROCA DE TURNO", referencia: "20/09/2026", valor: 50 },
    { codigo: 990, descricao: "VALE REFEIÇÃO ALMOÇO − SÁBADO", referencia: "12/09/2026", valor: -35.5 },
  ],
  totalLista: 2535.23, acerto: null, total: 2535.23, dataPagamento: null,
  ...over,
});
const quinzena: ReciboPagoAntes = {
  ...pessoa, cpf: null, tipo: "QUINZENA", id: "t1", competencia: "09/2026", referencia: "1ª quinzena de 09/2026",
  linhas: [{ codigo: 10, descricao: "1ª QUINZENA", referencia: "50%", valor: 1300 }], total: 1300, dataPagamento: "2026-09-15",
};
const adiantamento: ReciboPagoAntes = {
  ...quinzena, tipo: "ADIANTAMENTO", id: "t2", referencia: "adiantamento de 09/2026",
  linhas: [{ codigo: 20, descricao: "ADIANTAMENTO", referencia: "40%", valor: 1040 }], total: 1040, dataPagamento: null,
};

describe("texto e totais", () => {
  test("valor por extenso e referência, sem empresa", () => {
    expect(textoDoReciboPagamento(mes()).replace(/ /g, " ")).toBe(
      "Recebi a importância de R$ 2.535,23 (dois mil quinhentos e trinta e cinco reais e vinte e três centavos), "
      + "referente ao pagamento do mês de 09/2026.",
    );
    expect(textoDoReciboPagamento(quinzena)).toContain("referente à 1ª quinzena de 09/2026");
    expect(textoDoReciboPagamento(adiantamento)).toContain("referente ao adiantamento de 09/2026");
  });

  test("Total de Vencimentos − Total de Descontos = Valor Líquido = total do recibo", () => {
    for (const r of [mes(), quinzena, adiantamento]) {
      const t = totaisDoRecibo(r.linhas);
      expect(t.liquido).toBe(r.total);
      expect(Math.round((t.vencimentos - t.descontos) * 100) / 100).toBe(r.total);
    }
    expect(totaisDoRecibo(mes().linhas)).toEqual({ vencimentos: 3610.73, descontos: 1075.5, liquido: 2535.23 });
  });

  test("mês por extenso", () => {
    expect(mesPorExtenso("09/2026")).toBe("Setembro de 2026");
    expect(mesPorExtenso("03/2027")).toBe("Março de 2027");
  });
});

describe("parabéns pelo aniversário", () => {
  test("pagamento do mês sem baixa: mês seguinte à competência", () => {
    expect(mesDoPagamento(mes())).toBe(10);
    expect(linhaDeParabens(mes())).toBe("*** PARABÉNS PELO SEU ANIVERSÁRIO NO DIA 12 DE OUTUBRO ***");
    expect(mesDoPagamento(mes({ competencia: "12/2026" }))).toBe(1);
  });
  test("quem recebe por quinzena: o pagamento do mês sai no próprio mês da competência", () => {
    expect(mesDoPagamento(mes({ pagamentoQuinzenal: true }))).toBe(9);
    expect(linhaDeParabens(mes({ pagamentoQuinzenal: true }))).toBeNull();
    expect(linhaDeParabens(mes({ pagamentoQuinzenal: true, aniversario: "02/09" }))).toBe("*** PARABÉNS PELO SEU ANIVERSÁRIO NO DIA 02 DE SETEMBRO ***");
  });
  test("pago: o mês da baixa; quinzena/adiantamento sem baixa: o próprio mês", () => {
    expect(linhaDeParabens(mes({ dataPagamento: "2026-09-30" }))).toBeNull();
    expect(linhaDeParabens(quinzena)).toBeNull();
    expect(linhaDeParabens({ ...adiantamento, aniversario: "25/09" })).toBe("*** PARABÉNS PELO SEU ANIVERSÁRIO NO DIA 25 DE SETEMBRO ***");
    expect(linhaDeParabens({ ...adiantamento, aniversario: null })).toBeNull();
  });
});

describe("PDF", () => {
  test("layout do holerite: cabeçalho, colunas, totais, valor mensal; sem empresa e sem 'salário'", async () => {
    await gerarRecibosPagamento([mes()]);
    const todos = enviados.join("\n");
    for (const t of ["RECIBO DE PAGAMENTO", "Pagamento do mês", "Setembro de 2026", "Código", "Nome do Funcionário", "Descrição", "Referência",
      "Vencimentos", "Descontos", "Total de Vencimentos", "Total de Descontos", "Valor Líquido", "Valor mensal"]) {
      expect(enviados).toContain(t);
    }
    expect(enviados).toContain("FULANA - DE TAL EXEMPLO");
    expect(enviados).toContain("ATENDENTE - SALÃO");
    expect(enviados).toContain("Admissão:   02/03/2026");
    expect(enviados).toContain("111.222.333-44");
    expect(enviados).toContain("981");
    expect(enviados).toContain("1.040,00");
    expect(enviados).toContain("3.610,73");
    expect(enviados).toContain("1.075,50");
    expect(enviados).toContain("2.535,23");
    expect(enviados).toContain("2.600,00");
    expect(enviados.filter((t) => t === "*** PARABÉNS PELO SEU ANIVERSÁRIO NO DIA 12 DE OUTUBRO ***")).toHaveLength(2);
    expect(todos).not.toMatch(/sal[áa]rio|holerite|empregado|CNPJ|LTDA|raz[ãa]o social|INSS|FGTS|IRRF/i);
  });

  test("faixa à direita em pé: declaração, assinatura e data (em branco sem baixa; a da baixa quando pago)", async () => {
    await gerarRecibosPagamento([adiantamento]);
    expect(girados).toContain("Declaro ter recebido a importância líquida discriminada neste recibo.");
    expect(girados).toContain("Assinatura do Funcionário");
    expect(girados).toContain("___/___/______");
    expect(girados.filter((t) => t === "Data")).toHaveLength(2);
    girados.length = 0;
    await gerarRecibosPagamento([quinzena]);
    expect(girados).toContain("15/09/2026");
  });

  test("sem CPF: espaço para preencher", async () => {
    await gerarRecibosPagamento([quinzena]);
    expect(enviados).toContain("___.___.___-__");
    expect(enviados).toContain("50%");
  });

  test("só caracteres que a fonte desenha: nada de − nem –", async () => {
    await gerarRecibosPagamento([mes(), quinzena, adiantamento]);
    const todos = enviados.join("\n");
    expect(todos).not.toMatch(/[−–‐⇨]/);
    expect(foraDoPdf(todos)).toEqual([]);
  });

  test("todos: uma página por pessoa com total > 0, duas vias iguais", async () => {
    await gerarRecibosPagamento([mes(), mes({ employeeId: "e2", nome: "Beltrano Exemplo" }), mes({ employeeId: "e3", total: 0 }), adiantamento]);
    expect(paginas).toBe(3);
    expect(enviados.filter((t) => t === "RECIBO DE PAGAMENTO")).toHaveLength(6);
  });

  test("nenhum com valor: erro claro", async () => {
    await expect(gerarRecibosPagamento([mes({ total: 0 })])).rejects.toThrow(/Nenhum recibo/);
  });
});
