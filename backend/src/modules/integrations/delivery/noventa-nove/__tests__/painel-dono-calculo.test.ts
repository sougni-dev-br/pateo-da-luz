import { describe, expect, test } from "vitest";
import { participacao, pct, precoDeTabela, projetarMes, reais, ticketMedio, variacao } from "../painel-dono-calculo.js";

describe("variacao diz quando NAO ha base de comparacao", () => {
  // A 99 so tem dados desde abril/2026. Comparar setembro com setembro do ano
  // passado cai em `anterior = 0`. O calculo do iFood devolvia 100% nesse caso,
  // e a tela anunciaria um crescimento que ninguem teve.
  test("base zero nao vira +100%", () => {
    const v = variacao(34_291.27, 0);
    expect(v.comparavel).toBe(false);
    expect(v.percentual).toBe(0);
  });

  test("com base, calcula normalmente", () => {
    const v = variacao(120, 100);
    expect(v).toEqual({ percentual: 20, comparavel: true });
  });

  test("queda vem negativa", () => {
    expect(variacao(80, 100).percentual).toBe(-20);
  });

  test("os dois zerados tambem nao e comparavel", () => {
    expect(variacao(0, 0).comparavel).toBe(false);
  });

  test("caso real: junho x maio da 99", () => {
    const v = variacao(63_353.14, 68_009.27);
    expect(v.comparavel).toBe(true);
    expect(v.percentual).toBeCloseTo(-6.85, 2);
  });
});

describe("projecao projeta de verdade", () => {
  // O iFood devolvia `projection.grossAmount = total do mes corrente`, o que com
  // mock de mes inteiro passava batido. Com dado real, no dia 18, isso mostra
  // metade do mes como se fosse o fechamento.
  test("mes em curso extrapola pela media diaria", () => {
    const p = projetarMes({
      grossAteAgora: 34_291.27, netAteAgora: 30_000, diasComVenda: 17,
      diaDeHoje: 18, diasNoMes: 30, mesEmCurso: true
    });
    expect(p.ehProjecao).toBe(true);
    // 34.291,27 / 18 * 30
    expect(p.grossAmount).toBeCloseTo(57_152.12, 1);
    expect(p.diasRestantes).toBe(12);
  });

  test("NAO repete o total do que ja aconteceu", () => {
    const p = projetarMes({
      grossAteAgora: 34_291.27, netAteAgora: 30_000, diasComVenda: 17,
      diaDeHoje: 18, diasNoMes: 30, mesEmCurso: true
    });
    expect(p.grossAmount).toBeGreaterThan(34_291.27);
  });

  test("mes fechado devolve o realizado e avisa que nao e projecao", () => {
    const p = projetarMes({
      grossAteAgora: 63_353.14, netAteAgora: 57_520.36, diasComVenda: 30,
      diaDeHoje: 30, diasNoMes: 30, mesEmCurso: false
    });
    expect(p.ehProjecao).toBe(false);
    expect(p.grossAmount).toBe(63_353.14);
    expect(p.diasRestantes).toBe(0);
  });

  test("dia 1 nao divide por zero", () => {
    const p = projetarMes({
      grossAteAgora: 1_000, netAteAgora: 900, diasComVenda: 1,
      diaDeHoje: 1, diasNoMes: 31, mesEmCurso: true
    });
    expect(p.grossAmount).toBe(31_000);
  });

  // Dia sem venda e dia fraco, nao dia inexistente: dividir so pelos dias com
  // venda inflaria a media e a projecao junto.
  test("divide pelos dias corridos, nao pelos dias com venda", () => {
    const p = projetarMes({
      grossAteAgora: 1_000, netAteAgora: 900, diasComVenda: 5,
      diaDeHoje: 10, diasNoMes: 30, mesEmCurso: true
    });
    expect(p.grossAmount).toBe(3_000);
  });
});

describe("ticket medio e participacao", () => {
  test("junho da 99: R$ 63.353,14 em 1.400 pedidos", () => {
    expect(ticketMedio(63_353.14, 1400)).toBeCloseTo(45.25, 2);
  });

  test("sem pedido nao estoura", () => {
    expect(ticketMedio(100, 0)).toBe(0);
  });

  test("participacao da Frei Caneca em junho", () => {
    expect(participacao(25_483.87, 63_353.14)).toBeCloseTo(40.23, 2);
  });

  test("total zero nao estoura", () => {
    expect(participacao(10, 0)).toBe(0);
  });
});

describe("preco de tabela — a conta que o dono precisa ver", () => {
  // Setembro/2026 medido em producao a partir de `mealOriginalAmount`, sobre os
  // MESMOS pedidos que o painel conta (channel DELIVERY / DELIVERY_REFUND) —
  // uma medicao anterior somava todos os canais e dava outro denominador.
  const SET = {
    tabela: 72_089.81, bruto: 34_291.27, liquido: 30_663.70,
    bancadoPelaLoja: 26_951.17, pedidosComTabela: 982, pedidosTotal: 982
  };

  test("o bruto e menos da metade do preco anunciado", () => {
    expect(precoDeTabela(SET).brutoSobreTabelaPercent).toBeCloseTo(47.6, 1);
  });

  // O painel dizia "ficou com a loja: 89,4%" — certo sobre o bruto, mas o bruto
  // ja e a receita depois do desconto. Sobre o que a loja anuncia, sao 42,5%.
  test("o que chega ao caixa e 42,5% do anunciado, nao 89,4%", () => {
    const p = precoDeTabela(SET);
    expect(p.liquidoSobreTabelaPercent).toBeCloseTo(42.5, 1);
    expect(p.liquidoSobreTabelaPercent).toBeLessThan(50);
    // 89,4% e o mesmo liquido sobre o BRUTO — os dois numeros sao verdadeiros, e
    // por isso a tela precisa dizer sobre qual base cada um fala.
    expect(participacao(SET.liquido, SET.bruto)).toBeCloseTo(89.4, 1);
  });

  test("separa quem bancou o desconto — a loja paga a maior parte", () => {
    const p = precoDeTabela(SET);
    expect(p.descontoTotal).toBeCloseTo(37_798.54, 1);
    expect(p.bancadoPelaLoja).toBeCloseTo(26_951.17, 1);
    expect(p.bancadoPelaPlataforma).toBeCloseTo(10_847.37, 1);
    expect(p.bancadoPelaLoja + p.bancadoPelaPlataforma).toBeCloseTo(p.descontoTotal, 1);
  });

  test("o desconto e mais da metade do preco anunciado", () => {
    expect(precoDeTabela(SET).descontoPercent).toBeCloseTo(52.4, 1);
  });

  // A tela desenha o preco de tabela como quatro fatias: liquido + retido pela
  // 99 + desconto bancado pela loja + desconto bancado pela plataforma. Se isso
  // nao fechar, a barra mente por omissao.
  test("as quatro fatias da tela somam o preco de tabela", () => {
    const p = precoDeTabela(SET);
    const retidoPelaPlataforma = p.bruto - p.liquido;
    expect(p.liquido + retidoPelaPlataforma + p.bancadoPelaLoja + p.bancadoPelaPlataforma).toBeCloseTo(p.tabela, 1);
  });

  // abr–jun vieram do relatorio do portal, que nao traz mealOriginalAmount.
  test("sem preco de tabela marca indisponivel, em vez de mostrar zero como se fosse fato", () => {
    const p = precoDeTabela({ tabela: 0, bruto: 63_353.14, liquido: 57_520.36, bancadoPelaLoja: 0, pedidosComTabela: 0, pedidosTotal: 1400 });
    expect(p.disponivel).toBe(false);
    expect(p.cobertura).toEqual({ comTabela: 0, total: 1400 });
  });

  test("cobertura parcial fica registrada, para a tela poder ressalvar", () => {
    const p = precoDeTabela({ ...SET, pedidosComTabela: 800, pedidosTotal: 982 });
    expect(p.disponivel).toBe(true);
    expect(p.cobertura).toEqual({ comTabela: 800, total: 982 });
  });
});

describe("texto em pt-BR", () => {
  // As mensagens de alerta misturavam "52.4%" com "R$ 26.951,17" na mesma frase.
  test("percentual sai com virgula, nao com ponto", () => {
    expect(pct(52.43)).toBe("52,4");
    expect(pct(55)).toBe("55,0");
  });

  test("valor sai no formato brasileiro", () => {
    expect(reais(26_951.17)).toBe("26.951,17");
  });
});
