import { describe, expect, test } from "vitest";
import type { MonthlyClosureState } from "../../api/client";
import { dataComHora, montarResumoDoFechamento, nomeDaJustificativa } from "../fechamento-resumo";

const GERADO_EM = new Date("2026-10-21T15:30:00.000Z"); // 12:30 em São Paulo

function estado(parcial: Partial<MonthlyClosureState> = {}): MonthlyClosureState {
  return {
    competenceYear: 2026,
    competenceMonth: 9,
    monthStart: "2026-09-01T00:00:00.000Z",
    monthEnd: "2026-09-30T23:59:59.999Z",
    status: "OPEN",
    closedAt: null,
    closedByUserId: null,
    closedByName: null,
    reopenReason: null,
    revenue: {
      salon: { grossAmount: 208000, netAmount: 208000, daysCount: 26, entryCount: 26 },
      ifood: { grossAmount: 0, count: 0 },
      noventaNove: { grossAmount: 0, count: 0 },
      outrosDelivery: { grossAmount: 900, count: 1, plataformas: ["KEETA"] },
      eventos: { lancamentos: 2, valor: 7500 },
      total: { grossAmount: 216400, netAmount: 216400 }
    },
    purchases: { total: 1000, count: 3, byCategory: [] },
    requiredSuppliers: [
      { id: "s1", name: "Condomínio", group: "Fixos", frequency: "MONTHLY", appliesThisMonth: true, present: false, total: 0, purchaseCount: 0 },
      { id: "s2", name: "Contador", group: "Fixos", frequency: "MONTHLY", appliesThisMonth: true, present: true, total: 500, purchaseCount: 1 }
    ],
    taxes: [],
    cards: {
      cartoes: [{ id: "c1", name: "Visa", last4Digits: "1234" }],
      faturas: [{ creditCardId: "c1", status: "CHECKED", itensComDivergencia: 0 }]
    },
    finalInventory: { hasSnapshot: false },
    cmvAttribution: { total: 0, breakdown: [] },
    justifications: [],
    summary: { pendingCount: 0, pending: [], canLock: true },
    ...parcial
  } as unknown as MonthlyClosureState;
}

const resumo = (s: MonthlyClosureState, pendentes = s.summary.pending, hoje = new Date(2026, 9, 21)) =>
  montarResumoDoFechamento({ state: s, cmv: null, hoje, geradoEm: GERADO_EM, geradoPor: "Eli" });

describe("cabeçalho e situação", () => {
  test("título, período e quem gerou", () => {
    const r = resumo(estado());
    expect(r.titulo).toBe("Fechamento mensal — Setembro / 2026");
    expect(r.periodo).toMatch(/01\/09\/2026 a 30\/09\/2026/);
    expect(r.geradoPor).toBe("Eli");
    expect(r.geradoEm).toMatch(/21\/10\/2026/);
  });

  test("mês aberto não diz que está travado", () => {
    expect(resumo(estado()).situacao).toBe("ABERTO");
  });

  test("mês travado diz quando e por quem", () => {
    const r = resumo(estado({ status: "CLOSED", closedAt: "2026-10-15T12:00:00.000Z", closedByName: "Ana" }));
    expect(r.situacao).toBe("TRAVADO");
    expect(r.situacaoTexto).toMatch(/15\/10\/2026/);
    expect(r.situacaoTexto).toMatch(/Ana/);
  });
});

describe("números do mês", () => {
  test("faturamento bruto, compras e estoque final, em reais", () => {
    const r = resumo(estado());
    const por = (rotulo: string) => r.numeros.find((n) => n.rotulo === rotulo)?.valor;
    expect(por("Faturamento bruto")).toMatch(/216\.400,00/);
    expect(por("Compras no mês")).toMatch(/1\.000,00/);
    expect(por("Estoque final")).toBe("não contado");
  });

  test("CMV sem inventário final não aparece como número", () => {
    const r = resumo(estado());
    expect(r.numeros.find((n) => n.rotulo === "CMV do mês")?.valor).toBe("depende do inventário final");
  });
});

describe("pendências", () => {
  const pend = [
    { key: "card:c1", label: "Cartão Visa (final 1234): fatura não conferida" },
    { key: "block:finalInventory", label: "Inventario final do mes ausente" }
  ];

  test("mês terminado: tudo em aberto vira pendência (atenção)", () => {
    const r = resumo(estado({ summary: { pendingCount: 2, pending: pend, canLock: false } }));
    expect(r.totais.pendentes).toBe(2);
    expect(r.totais.aguardando).toBe(0);
    expect(r.pendencias.map((g) => g.grupo)).toEqual(["Cartões de crédito", "Estoque"]);
  });

  test("mês em andamento: o que só existe no fim fica como 'aguardando'", () => {
    const r = montarResumoDoFechamento({
      state: estado({ summary: { pendingCount: 2, pending: pend, canLock: false } }),
      cmv: null,
      hoje: new Date(2026, 8, 10),
      geradoEm: GERADO_EM,
      geradoPor: "Eli"
    });
    expect(r.totais.aguardando).toBe(2);
    expect(r.totais.pendentes).toBe(0);
  });

  test("cada pendência traz título e detalhe", () => {
    const r = resumo(estado({ summary: { pendingCount: 1, pending: [pend[0]], canLock: false } }));
    expect(r.pendencias[0].itens[0].titulo).toBe("Cartão Visa (final 1234)");
    expect(r.pendencias[0].itens[0].detalhe).toBe("fatura não conferida");
  });
});

describe("conferências e justificativas", () => {
  const justs = [
    { blockKey: "block:eventRevenue", reason: "Conferi os 2 eventos.", justifiedByUserId: "u1", justifiedByName: "Eli", justifiedAt: "2026-10-20T15:00:00.000Z" },
    { blockKey: "card:c1", reason: "Cartão não usado.", justifiedByUserId: "u2", justifiedByName: null, justifiedAt: "2026-10-19T15:00:00.000Z" }
  ];

  test("distingue conferência de justificativa e ordena por data", () => {
    const r = resumo(estado({ justifications: justs }));
    expect(r.registros.map((x) => x.tipo)).toEqual(["Justificativa", "Conferência"]);
    expect(r.registros[1].nome).toBe("Eventos / empreitada");
  });

  test("nome do cartão vem do cadastro; sem nome do usuário mostra traço", () => {
    const r = resumo(estado({ justifications: justs }));
    expect(r.registros[0].nome).toBe("Cartão Visa (final 1234)");
    expect(r.registros[0].por).toBe("—");
    expect(r.registros[1].por).toBe("Eli");
  });

  test("data com hora no horário de São Paulo", () => {
    const r = resumo(estado({ justifications: [justs[0]] }));
    expect(r.registros[0].data).toMatch(/20\/10\/2026/);
    expect(r.registros[0].data).toMatch(/12:00/);
  });
});

describe("áreas", () => {
  test("área sem pendência aparece como OK; com pendência, como PENDENTE", () => {
    const r = resumo(estado({
      summary: { pendingCount: 1, pending: [{ key: "card:c1", label: "Cartão Visa: x" }], canLock: false }
    }));
    expect(r.areas.find((a) => a.area === "Faturamento")?.situacao).toBe("OK");
    expect(r.areas.find((a) => a.area === "Cartões de crédito")?.situacao).toBe("PENDENTE");
  });

  test("área só com justificativa aparece como JUSTIFICADO", () => {
    const r = resumo(estado({
      justifications: [{ blockKey: "card:c1", reason: "x", justifiedByUserId: "u", justifiedAt: "2026-10-01T00:00:00.000Z" }]
    }));
    expect(r.areas.find((a) => a.area === "Cartões de crédito")?.situacao).toBe("JUSTIFICADO");
  });

  test("observação das áreas com dado próprio", () => {
    const r = resumo(estado());
    expect(r.areas.find((a) => a.area === "Fornecedores obrigatórios")?.observacao).toMatch(/1 de 2 lançados/);
    expect(r.areas.find((a) => a.area === "Cartões de crédito")?.observacao).toMatch(/1 de 1 conferidos/);
    expect(r.areas.find((a) => a.area === "Faturamento")?.observacao).toMatch(/2 evento/);
  });

  test("Pessoal não fica com observação vazia", () => {
    expect(resumo(estado()).areas.find((a) => a.area === "Pessoal")?.observacao).toMatch(/folha e gorjeta/);
  });

  test("'Outros' só aparece se houver algo nela", () => {
    expect(resumo(estado()).areas.some((a) => a.area === "Outros")).toBe(false);
    const r = resumo(estado({ summary: { pendingCount: 1, pending: [{ key: "block:novaCoisa", label: "Algo novo" }], canLock: false } }));
    expect(r.areas.some((a) => a.area === "Outros")).toBe(true);
  });
});

describe("nomeDaJustificativa", () => {
  const s = estado();
  test("cartão e fornecedor vêm do cadastro", () => {
    expect(nomeDaJustificativa("card:c1", s)).toBe("Cartão Visa (final 1234)");
    expect(nomeDaJustificativa("supplier:s1", s)).toBe("Fornecedor Condomínio");
  });
  test("lançamento obrigatório do fornecedor traz o nome do fornecedor e do lançamento", () => {
    const comExigencias = {
      ...s,
      requiredSuppliers: [{
        id: "s1", name: "Condomínio", group: "Fixos", frequency: "MONTHLY", appliesThisMonth: true, present: false, total: 0, purchaseCount: 0,
        usaExigencias: true,
        requirements: [{ id: "r2", label: "Parcelamento de dívida", productName: "Parcelamento de dívida do condomínio", quitada: false, present: false, total: 0, purchaseCount: 0 }]
      }]
    } as unknown as MonthlyClosureState;
    expect(nomeDaJustificativa("supplier:s1:r2", comExigencias)).toBe("Fornecedor Condomínio — Parcelamento de dívida");
  });

  test("cadastro removido não quebra", () => {
    expect(nomeDaJustificativa("card:sumiu", s)).toBe("Cartão");
    expect(nomeDaJustificativa("supplier:sumiu", s)).toBe("Fornecedor");
  });
  test("chaves fixas têm nome curto", () => {
    expect(nomeDaJustificativa("block:taxes", s)).toBe("Impostos");
  });
});

describe("dataComHora", () => {
  test("mostra o dia e a hora de São Paulo, não o de UTC", () => {
    // 01:01 UTC de 22/10 ainda é 22:01 de 21/10 em São Paulo.
    expect(dataComHora("2026-10-22T01:01:00.000Z")).toBe("21/10/2026 22:01");
  });
});
