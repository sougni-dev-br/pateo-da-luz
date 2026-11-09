import { describe, expect, test } from "vitest";
import { lerConciliacaoIfood, planejarLinhasIfood } from "../ifood-conciliacao-import.js";

const CABECALHO = [
  "competencia", "fato_gerador", "tipo_lancamento", "descricao_lancamento", "valor", "pedido_associado_ifood",
  "data_criacao_pedido_associado", "data_repasse_esperada", "valor_transacao", "loja_id", "loja_id_curto",
  "data_apuracao_inicio", "data_apuracao_fim", "valor_cesta_final"
];

type L = {
  fato?: string; tipo: string; desc: string; valor: number; pedido?: string; criado?: string;
  repasse?: string; trans?: number; ini?: string; fim?: string; cesta?: number; loja?: string; curto?: string;
};

function linha(l: L): unknown[] {
  return [
    "2026-10", l.fato ?? "Venda", l.tipo, l.desc, l.valor, l.pedido ?? "", l.criado ?? "",
    l.repasse ?? "2026-11-04", l.trans ?? 0, l.loja ?? "uuid-loja-a", l.curto ?? "111",
    l.ini ?? "2026-10-05", l.fim ?? "2026-10-11", l.cesta ?? 0
  ];
}

/** Um pedido de R$ 100: comissão 16, transação 3, promoção da loja 10, entrada financeira 71. */
function pedido(id: string, dia: string, extra: Partial<L> = {}): unknown[][] {
  const base = { pedido: id, criado: `${dia}T12:00:00Z`, cesta: 100, ...extra };
  return [
    linha({ ...base, tipo: "Cobrança", desc: "Comissão do iFood", valor: -16 }),
    linha({ ...base, tipo: "Cobrança", desc: "Taxa de transação", valor: -3 }),
    linha({ ...base, tipo: "Subsídio", desc: "Promoção custeada pela loja", valor: -10 }),
    linha({ ...base, tipo: "Retenção", desc: "Taxa entrega iFood", valor: -8 }),
    linha({ ...base, tipo: "Entrada Financeira", desc: "Entrada Financeira", valor: 71 })
  ];
}

function cancelado(id: string, dia: string): unknown[][] {
  const base = { pedido: id, criado: `${dia}T12:00:00Z`, cesta: 50 };
  return [
    ...pedido(id, dia, { cesta: 50 }),
    linha({ ...base, fato: "Cancelamento Total", tipo: "Cobrança", desc: "Comissão do iFood", valor: 16 }),
    linha({ ...base, fato: "Cancelamento Total", tipo: "Cobrança", desc: "Taxa de transação", valor: 3 }),
    linha({ ...base, fato: "Cancelamento Total", tipo: "Subsídio", desc: "Promoção custeada pela loja", valor: 10 }),
    linha({ ...base, fato: "Cancelamento Total", tipo: "Retenção", desc: "Taxa entrega iFood", valor: 8 }),
    linha({ ...base, fato: "Cancelamento Total", tipo: "Entrada Financeira", desc: "Entrada Financeira", valor: -71 })
  ];
}

describe("lerConciliacaoIfood", () => {
  test("soma vendas, taxas e promoção da loja e conta os pedidos do mês", () => {
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), ...pedido("p2", "2026-10-07")]);
    expect(r.erros).toEqual([]);
    expect(r.lojas).toHaveLength(1);
    const loja = r.lojas[0]!;
    expect(loja).toMatchObject({
      lojaIdCurto: "111", competencia: "2026-10", pedidos: 2,
      vendas: 200, taxas: -38, promocaoLoja: -20, saldoAnterior: 0
    });
  });

  test("pedido cancelado não entra em vendas nem na contagem e seus estornos se anulam", () => {
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), ...cancelado("p2", "2026-10-07")]);
    const loja = r.lojas[0]!;
    expect(loja.pedidos).toBe(1);
    expect(loja.vendas).toBe(100);
    expect(loja.taxas).toBe(-19);
    expect(loja.promocaoLoja).toBe(-10);
  });

  test("bruto é vendas menos promoção da loja e líquido é vendas menos taxas e promoção da loja", () => {
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06")]);
    const loja = r.lojas[0]!;
    expect(loja.bruto).toBe(90);
    expect(loja.liquido).toBe(71);
  });

  test("saldo devedor de períodos anteriores fica fora do líquido e aparece à parte", () => {
    const saldo = linha({
      tipo: "Cobrança", desc: "Saldo devedor de períodos anteriores", valor: -500, fato: "Carregamento de Saldo Devedor"
    });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), saldo]);
    const loja = r.lojas[0]!;
    expect(loja.saldoAnterior).toBe(-500);
    expect(loja.liquido).toBe(71);
    expect(loja.liquidoComSaldo).toBe(-429);
  });

  test("ocorrência avulsa (reembolso ou desconto) entra como ajuste no líquido, como no portal", () => {
    const avulsa = linha({ fato: "Ocorrência Avulsa", tipo: "Subsídio", desc: "Reembolso subsídio", valor: 9.99 });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), avulsa]);
    const loja = r.lojas[0]!;
    expect(loja.ajustes).toBe(9.99);
    expect(loja.liquido).toBe(80.99);
    expect(loja.bruto).toBe(90);
  });

  test("débito de pacote de anúncios é serviço (custo), não ajuste, e reduz o líquido", () => {
    const anuncios = linha({
      fato: "Ocorrência Avulsa", tipo: "Ocorrência", valor: -50,
      desc: "ocorrência de débito para contratação do pacote de anúncios por parte do parceiro."
    });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), anuncios]);
    const loja = r.lojas[0]!;
    expect(loja.servicos).toBe(-50);
    expect(loja.ajustes).toBe(0);
    expect(loja.liquido).toBe(21);
  });

  test("ressarcimento e reembolso de qualquer fato gerador entram como ajuste, como no portal", () => {
    const ressarcimento = linha({ fato: "Ressarcimento/Indenização", tipo: "Ressarcimento", desc: "Ressarcimento iFood", valor: 36.29 });
    const reembolso = linha({ fato: "Venda", tipo: "Reembolso", desc: "Reembolso taxa de serviço iFood cobrada do cliente", valor: 0.08, pedido: "p1", criado: "2026-10-06T12:00:00Z" });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), ressarcimento, reembolso]);
    const loja = r.lojas[0]!;
    expect(loja.ajustes).toBe(36.37);
    expect(loja.liquido).toBe(107.37);
    expect(r.alertas).toEqual([]);
  });

  test("mensalidade (fechamento) é cobrança e entra nas taxas, como no portal", () => {
    const mensalidade = linha({ fato: "Fechamento", tipo: "Cobrança", desc: "Mensalidade", valor: -150 });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), mensalidade]);
    expect(r.lojas[0]!.taxas).toBe(-169);
  });

  test("lançamento de tipo desconhecido não é descartado em silêncio: gera aviso com a soma", () => {
    const novo = linha({ fato: "Venda", tipo: "Tipo Novo Do Portal", desc: "Algo que o iFood criou", valor: -7.5, pedido: "p1" });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), novo]);
    expect(r.alertas.join(" ")).toMatch(/tipo novo do portal/i);
    expect(r.alertas.join(" ")).toMatch(/-7,5/);
  });

  test("taxa de solicitação de frete é cobrança e entra nas taxas", () => {
    const frete = linha({ fato: "Solicitação frete", tipo: "Cobrança", desc: "Taxa Solicitação de Frete (iFood entrega)", valor: -1.84 });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), frete]);
    expect(r.lojas[0]!.taxas).toBe(-20.84);
  });

  test("separa as lojas pelo identificador e nunca mistura os totais", () => {
    const r = lerConciliacaoIfood([
      CABECALHO,
      ...pedido("p1", "2026-10-06"),
      ...pedido("p2", "2026-10-06", { loja: "uuid-loja-b", curto: "222" })
    ]);
    expect(r.lojas.map((l) => [l.lojaIdCurto, l.pedidos]).sort()).toEqual([["111", 1], ["222", 1]]);
  });

  test("repasse da semana é a soma dos valores distintos de valor_transacao", () => {
    const r = lerConciliacaoIfood([
      CABECALHO,
      ...pedido("p1", "2026-10-13", { ini: "2026-10-12", fim: "2026-10-18", repasse: "2026-11-11", trans: 38.12 }),
      linha({
        tipo: "Cobrança", desc: "Saldo devedor de períodos anteriores", valor: -511.2, fato: "Carregamento de Saldo Devedor",
        ini: "2026-10-12", fim: "2026-10-18", repasse: "2026-11-11", trans: -511.2
      })
    ]);
    expect(r.lojas[0]!.repasses).toEqual([
      { inicio: "2026-10-12", fim: "2026-10-18", previsao: "2026-11-11", valor: -473.08 }
    ]);
  });

  test("recusa arquivo sem as colunas do relatório de conciliação", () => {
    const r = lerConciliacaoIfood([["data", "valor"], ["2026-10-01", 10]]);
    expect(r.lojas).toEqual([]);
    expect(r.erros[0]).toMatch(/Colunas obrigatórias/);
  });

  test("recusa arquivo com mais de uma competência: um mês por vez", () => {
    const outra = pedido("p9", "2026-09-30").map((l) => ["2026-09", ...l.slice(1)]);
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), ...outra]);
    expect(r.lojas).toEqual([]);
    expect(r.erros[0]).toMatch(/mais de uma competência/);
  });
});

describe("validações do arquivo", () => {
  test("recusa competência com mês inválido ou futura", () => {
    const mes13 = pedido("p1", "2026-10-06").map((l) => ["2026-13", ...l.slice(1)]);
    expect(lerConciliacaoIfood([CABECALHO, ...mes13]).erros[0]).toMatch(/competência/);
    const futura = pedido("p1", "2026-10-06").map((l) => ["2999-01", ...l.slice(1)]);
    expect(lerConciliacaoIfood([CABECALHO, ...futura]).erros[0]).toMatch(/competência/);
  });

  test("recusa identificador curto de loja que não é numérico", () => {
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06", { curto: "../x" })]);
    expect(r.erros[0]).toMatch(/loja/);
  });

  test("recusa o mesmo identificador curto para duas lojas diferentes", () => {
    const r = lerConciliacaoIfood([
      CABECALHO,
      ...pedido("p1", "2026-10-06"),
      ...pedido("p2", "2026-10-06", { loja: "uuid-loja-b", curto: "111" })
    ]);
    expect(r.erros[0]).toMatch(/mais de uma loja/);
  });

  test("número em texto ambíguo é recusado em vez de lido errado", () => {
    const l = pedido("p1", "2026-10-06");
    l[0]![4] = "1.500";
    expect(lerConciliacaoIfood([CABECALHO, ...l]).erros[0]).toMatch(/valor/);
  });

  test("número em texto com vírgula decimal e milhar com ponto é aceito", () => {
    const l = pedido("p1", "2026-10-06");
    l[0]![4] = "-1.234,50";
    const r = lerConciliacaoIfood([CABECALHO, ...l]);
    expect(r.erros).toEqual([]);
    expect(r.lojas[0]!.taxas).toBe(-1237.5);
  });

  test("avisa de cancelamento parcial e de pedido sem valor de cesta", () => {
    const parcial = linha({ fato: "Cancelamento Parcial", tipo: "Cobrança", desc: "Comissão do iFood", valor: 1, pedido: "p1" });
    const semCesta = pedido("p2", "2026-10-07", { cesta: undefined as unknown as number });
    semCesta.forEach((l) => { l[13] = ""; });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), parcial, ...semCesta]);
    expect(r.alertas.join(" ")).toMatch(/cancelamento parcial/i);
    expect(r.alertas.join(" ")).toMatch(/sem valor/i);
    // o pedido sem valor de venda fica fora da contagem e das vendas
    expect(r.lojas[0]!.pedidos).toBe(1);
    expect(r.lojas[0]!.vendas).toBe(100);
  });

  test("cancelamento parcial informa o valor devolvido ao cliente no alerta", () => {
    const parcial = linha({ fato: "Cancelamento Parcial", tipo: "Entrada Financeira", desc: "Entrada Financeira", valor: -12.5, pedido: "p1" });
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), parcial]);
    expect(r.alertas.join(" ")).toMatch(/12,50/);
  });

  test("taxas ou promoção com sinal positivo indicam arquivo trocado e são recusadas", () => {
    const l = pedido("p1", "2026-10-06");
    l[0]![4] = 16;
    const r = lerConciliacaoIfood([CABECALHO, ...l, ...pedido("p2", "2026-10-07").map((x) => { x[4] = typeof x[4] === "number" && x[4] < 0 ? -x[4] : x[4]; return x; })]);
    expect(r.lojas).toEqual([]);
    expect(r.erros.join(" ")).toMatch(/sinal/);
  });

  test("estorno total de pedido cuja venda não está no arquivo vira alerta", () => {
    const soEstorno = cancelado("p7", "2026-10-07").filter((l) => l[1] === "Cancelamento Total");
    const r = lerConciliacaoIfood([CABECALHO, ...pedido("p1", "2026-10-06"), ...soEstorno]);
    expect(r.alertas.join(" ")).toMatch(/estorno total/i);
  });

  test("erro informa o número da linha da planilha e quantos erros ficaram de fora", () => {
    const ruins = Array.from({ length: 25 }, () => linha({ tipo: "Cobrança", desc: "x", valor: Number.NaN }));
    const r = lerConciliacaoIfood([["Relatório"], CABECALHO, ...ruins]);
    expect(r.erros[0]).toMatch(/Linha 3 da planilha/);
    expect(r.erros[r.erros.length - 1]).toMatch(/mais 5 erro/);
  });

  test("competência em célula de data é lida como ano-mês", () => {
    const comData = pedido("p1", "2026-10-06").map((l) => [new Date(Date.UTC(2026, 9, 1)), ...l.slice(1)]);
    const r = lerConciliacaoIfood([CABECALHO, ...comData]);
    expect(r.erros).toEqual([]);
    expect(r.lojas[0]!.competencia).toBe("2026-10");
  });

  test("vendas sem nenhum repasse semanal extraído geram aviso", () => {
    const semRepasse = pedido("p1", "2026-10-06").map((l) => { l[7] = ""; return l; });
    const r = lerConciliacaoIfood([CABECALHO, ...semRepasse]);
    expect(r.avisos.join(" ")).toMatch(/nenhum repasse/i);
  });
});

describe("planejarLinhasIfood", () => {
  const loja = {
    lojaId: "uuid-loja-a", lojaIdCurto: "111", competencia: "2026-10", pedidos: 3,
    vendas: 300, taxas: -57, promocaoLoja: -30, servicos: 0, ajustes: 0, saldoAnterior: 0, bruto: 270, liquido: 213, liquidoComSaldo: 213, repasses: []
  };

  test("cria a linha mensal quando a loja ainda não tem lançamento no mês", () => {
    const [item] = planejarLinhasIfood([loja], []);
    expect(item!.acao).toBe("CRIAR");
    expect(item!.id).toBe("ifood-import-202610-111");
    expect(item!.anterior).toBeNull();
  });

  test("em alteração, o plano guarda o valor anterior da linha", () => {
    const existente = { id: "ifood-import-202610-111", loja: "111", competencia: "2026-10", orders: 1, grossAmount: 10, netAmount: 5 };
    expect(planejarLinhasIfood([loja], [existente])[0]!.anterior).toEqual({ pedidos: 1, bruto: 10, liquido: 5 });
  });

  test("altera a linha parcial já existente do mês e marca igual quando nada mudou", () => {
    const existente = { id: "ifood-import-202610-111", loja: "111", competencia: "2026-10", orders: 1, grossAmount: 10, netAmount: 5 };
    expect(planejarLinhasIfood([loja], [existente])[0]!.acao).toBe("ALTERAR");
    const igual = { ...existente, orders: 3, grossAmount: 270, netAmount: 213 };
    expect(planejarLinhasIfood([loja], [igual])[0]!.acao).toBe("IGUAL");
  });

  test("duas linhas ativas da mesma loja e mês viram conflito e não são tocadas", () => {
    const a = { id: "x1", loja: "111", competencia: "2026-10", orders: 1, grossAmount: 1, netAmount: 1 };
    const b = { id: "x2", loja: "111", competencia: "2026-10", orders: 1, grossAmount: 1, netAmount: 1 };
    expect(planejarLinhasIfood([loja], [a, b])[0]!.acao).toBe("CONFLITO");
  });
});
