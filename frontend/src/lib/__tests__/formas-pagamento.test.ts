import { describe, expect, test } from "vitest";
import {
  dividirValor, formaPermiteParcelamento, formasPorNomeBase,
  nomeBaseDaForma, parcelasNoNomeDaForma, somarDias,
} from "../formas-pagamento";

/** Formas reais do cadastro, como aparecem na lista crua. */
const FORMAS = [
  { id: "1", name: "BOLETO" },
  { id: "2", name: "BOLETO 2X" },
  { id: "3", name: "BOLETO 3X" },
  { id: "8", name: "BOLETO 8X" },
  { id: "9", name: "CARTAO CREDITO" },
  { id: "10", name: "CARTAO DEBITO" },
  { id: "11", name: "DINHEIRO" },
  { id: "12", name: "FATURADO" },
  { id: "13", name: "PIX" },
];

describe("nomeBaseDaForma", () => {
  test("tira a quantidade embutida no nome", () => {
    expect(nomeBaseDaForma("BOLETO 3X")).toBe("BOLETO");
    expect(nomeBaseDaForma("BOLETO 8X")).toBe("BOLETO");
  });

  test("mantém o nome quando não há quantidade", () => {
    expect(nomeBaseDaForma("PIX")).toBe("PIX");
    expect(nomeBaseDaForma("DINHEIRO")).toBe("DINHEIRO");
  });

  test("normaliza acento e variação de escrita", () => {
    expect(nomeBaseDaForma("CARTAO CREDITO")).toBe("CARTÃO CRÉDITO");
    expect(nomeBaseDaForma("cartão de crédito 6x")).toBe("CARTÃO CRÉDITO");
  });
});

describe("parcelasNoNomeDaForma", () => {
  test("lê a quantidade embutida", () => {
    expect(parcelasNoNomeDaForma("BOLETO 3X")).toBe(3);
    expect(parcelasNoNomeDaForma("BOLETO 8X")).toBe(8);
  });

  test("devolve null quando o nome não tem quantidade", () => {
    expect(parcelasNoNomeDaForma("BOLETO")).toBeNull();
    expect(parcelasNoNomeDaForma("PIX")).toBeNull();
  });
});

describe("formasPorNomeBase — o select não repete BOLETO oito vezes", () => {
  test("agrupa as variações num item só", () => {
    const lista = formasPorNomeBase(FORMAS);
    const boletos = lista.filter((forma) => forma.rotulo === "BOLETO");
    expect(boletos).toHaveLength(1);
  });

  test("escolhe a forma limpa como representante, não a 2X", () => {
    // Se o representante fosse "BOLETO 2X", toda compra sairia marcada como 2x.
    const boleto = formasPorNomeBase(FORMAS).find((forma) => forma.rotulo === "BOLETO");
    expect(boleto?.name).toBe("BOLETO");
  });

  test("mantém as demais formas", () => {
    const rotulos = formasPorNomeBase(FORMAS).map((forma) => forma.rotulo);
    expect(rotulos).toEqual(expect.arrayContaining(["BOLETO", "PIX", "DINHEIRO", "FATURADO", "CARTÃO CRÉDITO", "CARTÃO DÉBITO"]));
  });
});

describe("formaPermiteParcelamento", () => {
  test("boleto, faturado e cartão de crédito permitem", () => {
    expect(formaPermiteParcelamento({ id: "1", name: "BOLETO" })).toBe(true);
    expect(formaPermiteParcelamento({ id: "2", name: "FATURADO" })).toBe(true);
    expect(formaPermiteParcelamento({ id: "3", name: "CARTAO CREDITO" })).toBe(true);
  });

  test("pix, dinheiro e débito não permitem", () => {
    // O backend recusa mais de uma parcela nessas formas: a tela precisa saber
    // antes, para não deixar montar um parcelamento que vai ser rejeitado.
    expect(formaPermiteParcelamento({ id: "4", name: "PIX" })).toBe(false);
    expect(formaPermiteParcelamento({ id: "5", name: "DINHEIRO" })).toBe(false);
    expect(formaPermiteParcelamento({ id: "6", name: "CARTAO DEBITO" })).toBe(false);
  });

  test("reconhece pelo tipo quando o nome não ajuda", () => {
    expect(formaPermiteParcelamento({ id: "7", name: "Cobrança registrada", type: "bank_slip" })).toBe(true);
  });
});

describe("dividirValor — os centavos têm que fechar", () => {
  test("divide 7.150,07 em 2 como a tela de Compras faz", () => {
    expect(dividirValor(7150.07, 2)).toEqual([3575.03, 3575.04]);
  });

  test("a soma das parcelas devolve exatamente o total", () => {
    for (const [total, partes] of [[100, 3], [7150.07, 2], [209, 1], [1000.01, 7]] as const) {
      const soma = dividirValor(total, partes).reduce((acumulado, valor) => acumulado + valor, 0);
      expect(Number(soma.toFixed(2))).toBe(total);
    }
  });

  test("parcela única devolve o total inteiro", () => {
    expect(dividirValor(209, 1)).toEqual([209]);
  });
});

describe("somarDias", () => {
  test("soma sem pular dia por fuso", () => {
    expect(somarDias("2026-09-19", 7)).toBe("2026-09-26");
    expect(somarDias("2026-09-19", 0)).toBe("2026-09-19");
  });

  test("atravessa a virada do mês", () => {
    expect(somarDias("2026-09-25", 30)).toBe("2026-10-25");
  });

  test("data vazia ou inválida não quebra", () => {
    expect(somarDias("", 5)).toBe("");
    expect(somarDias("data-ruim", 5)).toBe("");
  });
});
