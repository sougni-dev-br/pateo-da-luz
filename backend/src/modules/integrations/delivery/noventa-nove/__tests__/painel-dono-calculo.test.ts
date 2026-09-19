import { describe, expect, test } from "vitest";
import { participacao, projetarMes, ticketMedio, variacao } from "../painel-dono-calculo.js";

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
